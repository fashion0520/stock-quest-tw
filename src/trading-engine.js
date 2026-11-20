export const INITIAL_CASH_CENTS = 100_000_000;
export const PORTFOLIO_SCHEMA_VERSION = 2;
export const DEFAULT_WATCHLIST = Object.freeze(['2330', '2317', '2603']);
export const FEE_RATE_DENOMINATOR = 1_000_000;
export const DEFAULT_FEE_RATES = Object.freeze({
  commissionPpm: 1_425,
  sellTaxPpm: 3_000,
});

const isSafeNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const isSafePositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

function assertCents(value, field) {
  if (!isSafeNonNegativeInteger(value)) {
    throw new TypeError(`${field} 必須是非負安全整數（新台幣分）。`);
  }
}

function assertQuantity(value) {
  if (!isSafePositiveInteger(value)) {
    throw new TypeError('股數必須是大於 0 的整數。');
  }
}

function assertFeeRates(rates) {
  for (const key of ['commissionPpm', 'sellTaxPpm']) {
    if (!rates || !isSafeNonNegativeInteger(rates[key])) {
      throw new TypeError(`費率 ${key} 必須是非負整數。`);
    }
  }
}

function roundRatio(numerator, denominator) {
  return Number((BigInt(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
}

export function createInitialPortfolio({ now = new Date().toISOString(), initialCashCents = INITIAL_CASH_CENTS } = {}) {
  assertCents(initialCashCents, '初始資金');
  return {
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    initialCashCents,
    cashCents: initialCashCents,
    createdAt: now,
    holdings: [],
    trades: [],
    watchlist: [...DEFAULT_WATCHLIST],
  };
}

export function validatePortfolioState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('帳戶資料格式錯誤。');
  }
  if (state.schemaVersion !== PORTFOLIO_SCHEMA_VERSION) {
    throw new TypeError('帳戶資料版本不支援。');
  }
  assertCents(state.initialCashCents, '初始資金');
  assertCents(state.cashCents, '現金餘額');
  if (typeof state.createdAt !== 'string' || !Array.isArray(state.holdings) || !Array.isArray(state.trades) || !Array.isArray(state.watchlist)) {
    throw new TypeError('帳戶資料缺少必要欄位。');
  }

  if (state.watchlist.some((symbol) => typeof symbol !== 'string' || !symbol.trim())
    || new Set(state.watchlist).size !== state.watchlist.length) {
    throw new TypeError('觀察清單格式錯誤。');
  }

  const seenSymbols = new Set();
  for (const holding of state.holdings) {
    if (!holding || typeof holding.symbol !== 'string' || !holding.symbol.trim() || seenSymbols.has(holding.symbol)) {
      throw new TypeError('持倉資料格式錯誤。');
    }
    seenSymbols.add(holding.symbol);
    assertQuantity(holding.quantity);
    assertCents(holding.costBasisCents, '持倉成本');
    if (!isSafePositiveInteger(holding.lastPriceCents)) {
      throw new TypeError('持倉參考價格格式錯誤。');
    }
  }

  for (const trade of state.trades) {
    if (!trade || typeof trade.id !== 'string' || typeof trade.symbol !== 'string' || !['buy', 'sell'].includes(trade.side)) {
      throw new TypeError('交易紀錄格式錯誤。');
    }
    assertQuantity(trade.quantity);
    assertCents(trade.priceCents, '成交價格');
    assertCents(trade.grossCents, '成交金額');
    assertCents(trade.commissionCents, '手續費');
    assertCents(trade.taxCents, '證交稅');
    if (!Number.isSafeInteger(trade.cashDeltaCents) || !Number.isSafeInteger(trade.realizedPnlCents) || typeof trade.executedAt !== 'string') {
      throw new TypeError('交易紀錄金額格式錯誤。');
    }
  }
  return state;
}

export function setWatchlisted(state, symbol, watchlisted) {
  validatePortfolioState(state);
  if (typeof symbol !== 'string' || !symbol.trim() || typeof watchlisted !== 'boolean') {
    throw new TypeError('觀察清單操作格式錯誤。');
  }
  const hasSymbol = state.watchlist.includes(symbol);
  if (hasSymbol === watchlisted) return state;
  const nextState = {
    ...state,
    watchlist: watchlisted ? [...state.watchlist, symbol] : state.watchlist.filter((item) => item !== symbol),
  };
  return validatePortfolioState(nextState);
}

export function calculateTradeCosts({ side, priceCents, quantity }, rates = DEFAULT_FEE_RATES) {
  if (!['buy', 'sell'].includes(side)) throw new TypeError('請選擇買進或賣出。');
  if (!isSafePositiveInteger(priceCents)) throw new TypeError('參考價格必須大於 0。');
  assertQuantity(quantity);
  assertFeeRates(rates);

  const grossCents = priceCents * quantity;
  if (!Number.isSafeInteger(grossCents)) throw new RangeError('成交金額超出可計算範圍。');
  const commissionCents = Number((BigInt(grossCents) * BigInt(rates.commissionPpm) + BigInt(FEE_RATE_DENOMINATOR / 2)) / BigInt(FEE_RATE_DENOMINATOR));
  const taxCents = side === 'sell'
    ? Number((BigInt(grossCents) * BigInt(rates.sellTaxPpm) + BigInt(FEE_RATE_DENOMINATOR / 2)) / BigInt(FEE_RATE_DENOMINATOR))
    : 0;
  if (!Number.isSafeInteger(commissionCents) || !Number.isSafeInteger(taxCents)) {
    throw new RangeError('交易費用超出可計算範圍。');
  }
  const cashDeltaCents = side === 'buy'
    ? -(grossCents + commissionCents)
    : grossCents - commissionCents - taxCents;

  return { grossCents, commissionCents, taxCents, totalFeesCents: commissionCents + taxCents, cashDeltaCents };
}

function makeTradeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `trade-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function executeTrade(state, order, {
  rates = DEFAULT_FEE_RATES,
  executedAt = new Date().toISOString(),
  id = makeTradeId(),
} = {}) {
  validatePortfolioState(state);
  const { symbol, side, quantity, priceCents } = order ?? {};
  if (typeof symbol !== 'string' || !symbol.trim()) throw new TypeError('請選擇股票。');
  const costs = calculateTradeCosts({ side, priceCents, quantity }, rates);
  const existing = state.holdings.find((holding) => holding.symbol === symbol);
  let holdings = state.holdings.map((holding) => ({ ...holding }));
  let realizedPnlCents = 0;

  if (side === 'buy') {
    const requiredCents = costs.grossCents + costs.commissionCents;
    if (state.cashCents < requiredCents) throw new RangeError('現金不足，無法完成這筆模擬買進。');
    const costBasisCents = (existing?.costBasisCents ?? 0) + requiredCents;
    if (!Number.isSafeInteger(costBasisCents)) throw new RangeError('持倉成本超出可計算範圍。');
    if (existing) {
      holdings = holdings.map((holding) => holding.symbol === symbol
        ? { ...holding, quantity: holding.quantity + quantity, costBasisCents, lastPriceCents: priceCents }
        : holding);
    } else {
      holdings.push({ symbol, quantity, costBasisCents, lastPriceCents: priceCents });
    }
  } else {
    if (!existing || existing.quantity < quantity) throw new RangeError('賣出股數不能超過目前持有股數。');
    const allocatedCostCents = quantity === existing.quantity
      ? existing.costBasisCents
      : roundRatio(BigInt(existing.costBasisCents) * BigInt(quantity), existing.quantity);
    realizedPnlCents = costs.grossCents - costs.commissionCents - costs.taxCents - allocatedCostCents;
    holdings = holdings.flatMap((holding) => {
      if (holding.symbol !== symbol) return [holding];
      if (holding.quantity === quantity) return [];
      return [{
        ...holding,
        quantity: holding.quantity - quantity,
        costBasisCents: holding.costBasisCents - allocatedCostCents,
        lastPriceCents: priceCents,
      }];
    });
  }

  const trade = {
    id,
    symbol,
    side,
    quantity,
    priceCents,
    ...costs,
    realizedPnlCents,
    executedAt,
  };
  const nextState = {
    ...state,
    cashCents: state.cashCents + costs.cashDeltaCents,
    holdings,
    trades: [trade, ...state.trades],
  };
  validatePortfolioState(nextState);
  return nextState;
}

export function getPortfolioSummary(state, quotes = []) {
  validatePortfolioState(state);
  const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const positions = state.holdings.map((holding) => {
    const quotePriceCents = quoteMap.get(holding.symbol)?.priceCents;
    const priceCents = isSafePositiveInteger(quotePriceCents) ? quotePriceCents : holding.lastPriceCents;
    const marketValueCents = priceCents * holding.quantity;
    if (!Number.isSafeInteger(marketValueCents)) throw new RangeError('持倉市值超出可計算範圍。');
    return {
      ...holding,
      priceCents,
      marketValueCents,
      unrealizedPnlCents: marketValueCents - holding.costBasisCents,
      averageCostCents: Math.round(holding.costBasisCents / holding.quantity),
    };
  });
  const marketValueCents = positions.reduce((sum, position) => sum + position.marketValueCents, 0);
  const realizedPnlCents = state.trades.reduce((sum, trade) => sum + trade.realizedPnlCents, 0);
  const unrealizedPnlCents = positions.reduce((sum, position) => sum + position.unrealizedPnlCents, 0);
  const totalAssetsCents = state.cashCents + marketValueCents;
  return {
    cashCents: state.cashCents,
    marketValueCents,
    totalAssetsCents,
    realizedPnlCents,
    unrealizedPnlCents,
    totalPnlCents: totalAssetsCents - state.initialCashCents,
    returnPercent: state.initialCashCents === 0 ? 0 : ((totalAssetsCents - state.initialCashCents) / state.initialCashCents) * 100,
    tradeCount: state.trades.length,
    holdingsCount: positions.length,
    positions,
  };
}


