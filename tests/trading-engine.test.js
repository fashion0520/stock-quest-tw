import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_CASH_CENTS,
  calculateTradeCosts,
  createInitialPortfolio,
  executeTrade,
  getPortfolioSummary,
  setWatchlisted,
  validatePortfolioState,
} from '../src/trading-engine.js';
import { loadPortfolio, PORTFOLIO_STORAGE_KEY, resetPortfolio, savePortfolio } from '../src/storage.js';

const buy = (state, quantity = 10, priceCents = 10_000) => executeTrade(state, {
  symbol: 'TEST', side: 'buy', quantity, priceCents,
}, { id: 'buy-1', executedAt: '2026-01-01T00:00:00.000Z' });

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, value); }
}

test('new account starts with one million TWD and no positions', () => {
  const state = createInitialPortfolio({ now: '2026-01-01T00:00:00.000Z' });
  assert.equal(state.cashCents, INITIAL_CASH_CENTS);
  assert.deepEqual(state.holdings, []);
  assert.deepEqual(state.trades, []);
  assert.deepEqual(state.watchlist, ['2330', '2317', '2603']);
  assert.equal(validatePortfolioState(state), state);
});

test('watchlist changes immutably, avoids duplicates, and can remove a symbol', () => {
  const start = createInitialPortfolio();
  const added = setWatchlisted(start, '2454', true);
  assert.deepEqual(added.watchlist, ['2330', '2317', '2603', '2454']);
  assert.deepEqual(start.watchlist, ['2330', '2317', '2603']);
  assert.equal(setWatchlisted(added, '2454', true), added);
  assert.deepEqual(setWatchlisted(added, '2317', false).watchlist, ['2330', '2603', '2454']);
});

test('trade cost estimate applies commission to both sides and stock tax only on sale', () => {
  const buyCosts = calculateTradeCosts({ side: 'buy', priceCents: 10_000, quantity: 10 });
  const sellCosts = calculateTradeCosts({ side: 'sell', priceCents: 10_000, quantity: 10 });
  assert.equal(buyCosts.grossCents, 100_000);
  assert.equal(buyCosts.commissionCents, 143);
  assert.equal(buyCosts.taxCents, 0);
  assert.equal(sellCosts.commissionCents, 143);
  assert.equal(sellCosts.taxCents, 300);
  assert.equal(sellCosts.cashDeltaCents, 99_557);
});

test('buy deducts gross amount and commission while keeping the input immutable', () => {
  const start = createInitialPortfolio({ now: '2026-01-01T00:00:00.000Z' });
  const next = buy(start);
  assert.equal(next.cashCents, INITIAL_CASH_CENTS - 100_143);
  assert.deepEqual(next.holdings, [{ symbol: 'TEST', quantity: 10, costBasisCents: 100_143, lastPriceCents: 10_000 }]);
  assert.equal(start.cashCents, INITIAL_CASH_CENTS);
  assert.deepEqual(start.holdings, []);
});

test('insufficient cash rejects the trade without changing the account', () => {
  const start = createInitialPortfolio({ initialCashCents: 10_000, now: '2026-01-01T00:00:00.000Z' });
  const snapshot = structuredClone(start);
  assert.throws(() => buy(start, 10, 10_000), /現金不足/);
  assert.deepEqual(start, snapshot);
});

test('selling more shares than owned is rejected without changing the account', () => {
  const start = buy(createInitialPortfolio(), 3);
  const snapshot = structuredClone(start);
  assert.throws(() => executeTrade(start, { symbol: 'TEST', side: 'sell', quantity: 4, priceCents: 10_000 }), /超過目前持有/);
  assert.deepEqual(start, snapshot);
});

test('partial sale realizes net proceeds and full sale removes the holding', () => {
  const start = buy(createInitialPortfolio(), 10, 10_000);
  const partial = executeTrade(start, { symbol: 'TEST', side: 'sell', quantity: 4, priceCents: 11_000 }, { id: 'sell-1' });
  const partialTrade = partial.trades[0];
  assert.equal(partial.holdings[0].quantity, 6);
  assert.equal(partialTrade.realizedPnlCents, 3_748);
  const full = executeTrade(partial, { symbol: 'TEST', side: 'sell', quantity: 6, priceCents: 11_000 }, { id: 'sell-2' });
  assert.deepEqual(full.holdings, []);
  assert.equal(full.trades[0].realizedPnlCents, 5_622);
  assert.equal(getPortfolioSummary(full).realizedPnlCents, 9_370);
});

test('invalid quantity and price are rejected', () => {
  assert.throws(() => calculateTradeCosts({ side: 'buy', priceCents: 100, quantity: 0 }), /股數/);
  assert.throws(() => calculateTradeCosts({ side: 'buy', priceCents: -1, quantity: 1 }), /參考價格/);
});

test('portfolio summary marks positions at quote price and reports return', () => {
  const state = buy(createInitialPortfolio(), 10, 10_000);
  const summary = getPortfolioSummary(state, [{ symbol: 'TEST', priceCents: 11_000 }]);
  assert.equal(summary.marketValueCents, 110_000);
  assert.equal(summary.unrealizedPnlCents, 9_857);
  assert.equal(summary.totalAssetsCents, state.cashCents + 110_000);
  assert.ok(summary.returnPercent > 0);
});

test('storage saves and reloads a validated account', () => {
  const storage = new MemoryStorage();
  const state = buy(createInitialPortfolio());
  assert.equal(savePortfolio(state, storage), true);
  assert.equal(storage.getItem(PORTFOLIO_STORAGE_KEY) !== null, true);
  assert.deepEqual(loadPortfolio(storage), { portfolio: state, status: 'loaded' });
});

test('storage migrates version one accounts and preserves them when migration cannot be saved', () => {
  const previous = createInitialPortfolio();
  delete previous.watchlist;
  previous.schemaVersion = 1;
  const storage = new MemoryStorage();
  storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(previous));
  const migrated = loadPortfolio(storage);
  assert.equal(migrated.status, 'migrated');
  assert.equal(migrated.portfolio.schemaVersion, 2);
  assert.deepEqual(migrated.portfolio.watchlist, ['2330', '2317', '2603']);
  assert.equal(loadPortfolio(storage).status, 'loaded');

  const readOnlyStorage = {
    getItem: () => JSON.stringify(previous),
    setItem: () => { throw new Error('read only'); },
  };
  const unsaved = loadPortfolio(readOnlyStorage);
  assert.equal(unsaved.status, 'migrated-unsaved');
  assert.equal(unsaved.portfolio.cashCents, INITIAL_CASH_CENTS);
});

test('corrupt stored data starts a fresh account and reset overwrites the saved state', () => {
  const storage = new MemoryStorage();
  storage.setItem(PORTFOLIO_STORAGE_KEY, '{broken');
  const recovered = loadPortfolio(storage);
  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.portfolio.cashCents, INITIAL_CASH_CENTS);
  const reset = resetPortfolio(storage);
  assert.equal(reset.saved, true);
  assert.equal(loadPortfolio(storage).status, 'loaded');
});

test('unavailable storage does not prevent using the in-memory account', () => {
  const loaded = loadPortfolio(null);
  assert.equal(loaded.status, 'unavailable');
  assert.equal(savePortfolio(loaded.portfolio, null), false);
});


