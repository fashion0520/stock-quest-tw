import { createInitialPortfolio, PORTFOLIO_SCHEMA_VERSION, validatePortfolioState } from './trading-engine.js';

export const PORTFOLIO_STORAGE_KEY = 'stock-quest.portfolio.v1';

function getBrowserStorage() {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadPortfolio(storage = getBrowserStorage()) {
  if (!storage) return { portfolio: createInitialPortfolio(), status: 'unavailable' };
  let raw;
  try {
    raw = storage.getItem(PORTFOLIO_STORAGE_KEY);
  } catch {
    return { portfolio: createInitialPortfolio(), status: 'unavailable' };
  }
  if (raw === null) return { portfolio: createInitialPortfolio(), status: 'fresh' };
  try {
    let portfolio = JSON.parse(raw);
    if (portfolio?.schemaVersion === 1 && Array.isArray(portfolio.holdings) && Array.isArray(portfolio.trades)) {
      portfolio = { ...portfolio, schemaVersion: PORTFOLIO_SCHEMA_VERSION, watchlist: ['2330', '2317', '2603'] };
      validatePortfolioState(portfolio);
      try {
        storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(portfolio));
        return { portfolio, status: 'migrated' };
      } catch {
        return { portfolio, status: 'migrated-unsaved' };
      }
    }
    validatePortfolioState(portfolio);
    return { portfolio, status: 'loaded' };
  } catch {
    return { portfolio: createInitialPortfolio(), status: 'recovered' };
  }
}

export function savePortfolio(portfolio, storage = getBrowserStorage()) {
  validatePortfolioState(portfolio);
  if (!storage) return false;
  try {
    storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(portfolio));
    return true;
  } catch {
    return false;
  }
}

export function resetPortfolio(storage = getBrowserStorage()) {
  const portfolio = createInitialPortfolio();
  return { portfolio, saved: savePortfolio(portfolio, storage) };
}


