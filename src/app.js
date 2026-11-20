import { QUOTES } from './market-data.js';
import { calculateTradeCosts, executeTrade, getPortfolioSummary, setWatchlisted } from './trading-engine.js';
import { loadPortfolio, resetPortfolio, savePortfolio } from './storage.js';

const quoteMap = new Map(QUOTES.map((quote) => [quote.symbol, quote]));
const loaded = loadPortfolio();
let portfolio = loaded.portfolio;
let toastTimer;
let quoteScope = 'watchlist';

const elements = {
  dialog: document.querySelector('#trade-dialog'),
  form: document.querySelector('#trade-form'),
  side: document.querySelector('#trade-side'),
  symbol: document.querySelector('#trade-symbol'),
  quantity: document.querySelector('#trade-quantity'),
  price: document.querySelector('#selected-price'),
  estimate: document.querySelector('#order-estimate'),
  error: document.querySelector('#order-error'),
  submit: document.querySelector('#submit-trade'),
};

const moneyFormatter = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (cents) => `NT$ ${moneyFormatter.format(cents / 100)}`;
const formatAccountMoney = (cents) => formatMoney(cents);
const formatPrice = (cents) => moneyFormatter.format(cents / 100);
const signedMoney = (cents) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${formatMoney(Math.abs(cents))}`;
const getQuote = (symbol) => quoteMap.get(symbol);
const getName = (symbol) => getQuote(symbol)?.name ?? symbol;

function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
globalThis.toast = toast;

function setProfitStyle(el, cents) {
  el.classList.toggle('up', cents > 0);
  el.classList.toggle('down', cents < 0);
}

function renderSummary() {
  const summary = getPortfolioSummary(portfolio, QUOTES);
  document.querySelector('#total-assets').textContent = formatAccountMoney(summary.totalAssetsCents);
  document.querySelector('#cash-value').textContent = formatAccountMoney(summary.cashCents);
  document.querySelector('#market-value').textContent = formatAccountMoney(summary.marketValueCents);
  document.querySelector('#trade-count').textContent = String(summary.tradeCount);
  const returnLabel = document.querySelector('#total-return');
  const returnPercent = Math.abs(summary.returnPercent) < 0.005 ? 0 : Number(summary.returnPercent.toFixed(2));
  returnLabel.textContent = `累計損益 ${signedMoney(summary.totalPnlCents)} (${returnPercent >= 0 ? '+' : ''}${returnPercent.toFixed(2)}%)　·　持有部位 ${summary.holdingsCount} 檔`;
  setProfitStyle(returnLabel, summary.totalPnlCents);
  const unrealized = document.querySelector('#unrealized-pnl');
  unrealized.textContent = signedMoney(summary.unrealizedPnlCents);
  setProfitStyle(unrealized, summary.unrealizedPnlCents);
  const realized = document.querySelector('#realized-pnl');
  realized.textContent = signedMoney(summary.realizedPnlCents);
  setProfitStyle(realized, summary.realizedPnlCents);
}

function renderQuotes() {
  const list = document.querySelector('#quote-list');
  const query = document.querySelector('#quote-search').value.trim().toLowerCase();
  const filtered = QUOTES.filter((quote) => (quoteScope === 'all' || portfolio.watchlist.includes(quote.symbol))
    && `${quote.symbol} ${quote.name} ${quote.sector}`.toLowerCase().includes(query));
  document.querySelector('#watchlist-count').textContent = quoteScope === 'watchlist' ? `${portfolio.watchlist.length} 檔自選` : `共 ${QUOTES.length} 檔`;
  list.replaceChildren();
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = quoteScope === 'watchlist' && !query ? '自選清單還沒有股票，前往「全部股票」加入第一檔。' : '找不到符合的股票，試試代號或名稱。';
    if (quoteScope === 'watchlist' && !query) {
      const showAll = document.createElement('button');
      showAll.type = 'button';
      showAll.className = 'quiet-button';
      showAll.dataset.quoteScope = 'all';
      showAll.textContent = '瀏覽全部股票';
      empty.append(document.createElement('br'), showAll);
    }
    list.append(empty);
    return;
  }

  for (const quote of filtered) {
    const row = document.createElement('div');
    row.className = 'stock-row';
    const identity = document.createElement('div');
    identity.className = 'stock-name';
    const logo = document.createElement('div');
    logo.className = 'stock-logo';
    logo.textContent = quote.name.slice(0, 1);
    const nameBlock = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = quote.name;
    const symbol = document.createElement('small');
    symbol.textContent = `${quote.symbol} · ${quote.sector}`;
    nameBlock.append(name, symbol);
    identity.append(logo, nameBlock);

    const price = document.createElement('div');
    price.className = 'stock-price';
    price.textContent = formatPrice(quote.priceCents);
    const change = document.createElement('div');
    const changeCents = quote.priceCents - quote.previousCloseCents;
    const changePercent = (changeCents / quote.previousCloseCents) * 100;
    change.className = `stock-change ${changeCents >= 0 ? 'up' : 'down'}`;
    change.textContent = `${changeCents >= 0 ? '+' : '−'}${Math.abs(changePercent).toFixed(2)}%`;
    const actions = document.createElement('div');
    actions.className = 'quote-actions';
    const watch = document.createElement('button');
    watch.className = 'watch-toggle';
    watch.type = 'button';
    watch.dataset.watchSymbol = quote.symbol;
    const isWatched = portfolio.watchlist.includes(quote.symbol);
    watch.setAttribute('aria-pressed', String(isWatched));
    watch.setAttribute('aria-label', `${isWatched ? '移出' : '加入'}自選 ${quote.name}`);
    watch.title = `${isWatched ? '移出' : '加入'}自選`;
    watch.textContent = isWatched ? '★' : '☆';
    const action = document.createElement('button');
    action.className = 'quote-action';
    action.type = 'button';
    action.dataset.buySymbol = quote.symbol;
    action.textContent = '模擬買進';
    actions.append(watch, action);
    row.append(identity, price, change, actions);
    list.append(row);
  }
}

function appendCell(row, text, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = text;
  row.append(cell);
  return cell;
}

function renderPositions() {
  const tbody = document.querySelector('#positions-body');
  const empty = document.querySelector('#positions-empty');
  const summary = getPortfolioSummary(portfolio, QUOTES);
  tbody.replaceChildren();
  empty.hidden = summary.positions.length > 0;
  for (const position of summary.positions) {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'table-stock';
    const name = document.createElement('b');
    name.textContent = getName(position.symbol);
    const symbol = document.createElement('small');
    symbol.textContent = position.symbol;
    nameCell.append(name, symbol);
    row.append(nameCell);
    appendCell(row, position.quantity.toLocaleString('zh-TW'));
    appendCell(row, formatPrice(position.averageCostCents));
    appendCell(row, formatPrice(position.priceCents));
    appendCell(row, formatAccountMoney(position.marketValueCents));
    const pnl = appendCell(row, signedMoney(position.unrealizedPnlCents), position.unrealizedPnlCents >= 0 ? 'up' : 'down');
    const actionCell = document.createElement('td');
    const sell = document.createElement('button');
    sell.type = 'button';
    sell.className = 'position-action';
    sell.dataset.sellSymbol = position.symbol;
    sell.textContent = '賣出';
    actionCell.append(sell);
    row.append(actionCell);
    tbody.append(row);
  }
}

function renderTrades() {
  const list = document.querySelector('#trades-list');
  const empty = document.querySelector('#trades-empty');
  list.replaceChildren();
  empty.hidden = portfolio.trades.length > 0;
  for (const trade of portfolio.trades.slice(0, 8)) {
    const entry = document.createElement('div');
    entry.className = 'trade-entry';
    const badge = document.createElement('div');
    badge.className = `trade-side-icon ${trade.side}`;
    badge.textContent = trade.side === 'buy' ? '買' : '賣';
    const detail = document.createElement('div');
    const title = document.createElement('b');
    title.textContent = `${getName(trade.symbol)} ${trade.side === 'buy' ? '買進' : '賣出'} ${trade.quantity} 股`;
    const time = document.createElement('small');
    time.textContent = `${new Date(trade.executedAt).toLocaleString('zh-TW')} · ${formatPrice(trade.priceCents)} · 費用 ${formatMoney(trade.totalFeesCents)}`;
    detail.append(title, time);
    const amount = document.createElement('strong');
    amount.textContent = trade.side === 'buy' ? `−${formatMoney(-trade.cashDeltaCents)}` : `+${formatMoney(trade.cashDeltaCents)}`;
    entry.append(badge, detail, amount);
    list.append(entry);
  }
}

function render() {
  renderSummary();
  renderQuotes();
  renderPositions();
  renderTrades();
}

function populateSymbolOptions() {
  elements.symbol.replaceChildren(...QUOTES.map((quote) => {
    const option = document.createElement('option');
    option.value = quote.symbol;
    option.textContent = `${quote.symbol} ${quote.name}`;
    return option;
  }));
}

function updatePreview() {
  const quote = getQuote(elements.symbol.value);
  const side = elements.side.value;
  const quantity = elements.quantity.valueAsNumber;
  elements.price.textContent = quote ? `NT$ ${formatPrice(quote.priceCents)}` : '—';
  elements.error.textContent = '';
  elements.submit.disabled = true;
  elements.submit.textContent = side === 'buy' ? '確認模擬買進' : '確認模擬賣出';

  if (!quote || !Number.isSafeInteger(quantity) || quantity <= 0) {
    elements.estimate.textContent = '請輸入大於 0 的整數股數。';
    return;
  }

  try {
    const costs = calculateTradeCosts({ side, priceCents: quote.priceCents, quantity });
    const total = side === 'buy' ? costs.grossCents + costs.commissionCents : costs.cashDeltaCents;
    const rows = [
      ['成交金額', formatMoney(costs.grossCents)],
      ['預估手續費', formatMoney(costs.commissionCents)],
      ['預估證交稅', formatMoney(costs.taxCents)],
      [side === 'buy' ? '預估扣款' : '預估入帳', formatMoney(total)],
    ];
    elements.estimate.replaceChildren(...rows.map(([label, value], index) => {
      const row = document.createElement('div');
      row.className = `estimate-row ${index === rows.length - 1 ? 'total' : ''}`;
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const valueEl = document.createElement(index === rows.length - 1 ? 'strong' : 'span');
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      return row;
    }));

    if (side === 'buy' && total > portfolio.cashCents) {
      elements.error.textContent = '現金不足，請減少股數或選擇其他股票。';
    } else if (side === 'sell') {
      const held = portfolio.holdings.find((holding) => holding.symbol === quote.symbol)?.quantity ?? 0;
      if (held === 0) elements.error.textContent = '目前沒有這檔持倉。';
      else if (quantity > held) elements.error.textContent = `目前持有 ${held.toLocaleString('zh-TW')} 股，請調整賣出數量。`;
    }
    elements.submit.disabled = elements.error.textContent !== '';
  } catch (error) {
    elements.error.textContent = error.message;
    elements.estimate.textContent = '無法計算這筆委託。';
  }
}

function openTradeDialog({ symbol, side = 'buy', quantity = 1 } = {}) {
  elements.side.value = side;
  if (symbol && getQuote(symbol)) elements.symbol.value = symbol;
  elements.quantity.value = String(quantity);
  updatePreview();
  elements.dialog.showModal();
  elements.quantity.focus();
}

function saveAndRender(nextPortfolio) {
  portfolio = nextPortfolio;
  const saved = savePortfolio(portfolio);
  render();
  return saved;
}

document.querySelector('#open-trade').addEventListener('click', () => openTradeDialog());
document.querySelector('#close-trade').addEventListener('click', () => elements.dialog.close());
document.querySelector('#quote-search').addEventListener('input', renderQuotes);
elements.side.addEventListener('change', updatePreview);
elements.symbol.addEventListener('change', updatePreview);
elements.quantity.addEventListener('input', updatePreview);

document.querySelector('#quote-list').addEventListener('click', (event) => {
  const watchButton = event.target.closest('[data-watch-symbol]');
  if (watchButton) {
    const symbol = watchButton.dataset.watchSymbol;
    const next = setWatchlisted(portfolio, symbol, !portfolio.watchlist.includes(symbol));
    const saved = saveAndRender(next);
    toast(saved ? `${getName(symbol)}${next.watchlist.includes(symbol) ? '已加入' : '已移出'}自選清單。` : '清單已更新，但瀏覽器未能保存。');
    return;
  }
  const button = event.target.closest('[data-buy-symbol]');
  if (button) openTradeDialog({ symbol: button.dataset.buySymbol, side: 'buy' });
});
document.querySelector('#stocks-panel').addEventListener('click', (event) => {
  const button = event.target.closest('[data-quote-scope]');
  if (!button) return;
  quoteScope = button.dataset.quoteScope;
  document.querySelectorAll('[data-quote-scope="all"], [data-quote-scope="watchlist"]').forEach((item) => {
    if (item.classList.contains('scope-button')) item.classList.toggle('active', item.dataset.quoteScope === quoteScope);
  });
  renderQuotes();
});
document.querySelector('#positions-body').addEventListener('click', (event) => {
  const button = event.target.closest('[data-sell-symbol]');
  if (!button) return;
  const holding = portfolio.holdings.find((item) => item.symbol === button.dataset.sellSymbol);
  openTradeDialog({ symbol: button.dataset.sellSymbol, side: 'sell', quantity: holding?.quantity ?? 1 });
});

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  updatePreview();
  if (elements.submit.disabled) return;
  const quote = getQuote(elements.symbol.value);
  const side = elements.side.value;
  const quantity = elements.quantity.valueAsNumber;
  try {
    const next = executeTrade(portfolio, {
      symbol: quote.symbol,
      side,
      quantity,
      priceCents: quote.priceCents,
    });
    const saved = saveAndRender(next);
    elements.dialog.close();
    const message = `${side === 'buy' ? '已模擬買進' : '已模擬賣出'} ${quote.name} ${quantity} 股。`;
    toast(saved ? message : `${message} 但瀏覽器未能保存資料，請勿重新載入。`);
  } catch (error) {
    elements.error.textContent = error.message;
  }
});

document.querySelector('#reset-account').addEventListener('click', () => {
  if (!window.confirm('重新開始會清除此瀏覽器內的模擬持倉與交易紀錄，並恢復 NT$1,000,000。要繼續嗎？')) return;
  const reset = resetPortfolio();
  portfolio = reset.portfolio;
  render();
  toast(reset.saved ? '練習帳戶已重設。' : '帳戶已在本頁重設，但瀏覽器未能保存。');
});

document.querySelectorAll('.nav button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.nav button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  document.querySelector('.crumb b').textContent = button.dataset.view;
  const targets = {
    '總覽': document.querySelector('.welcome'),
    '市場行情': document.querySelector('#market-panel'),
    '投資組合': document.querySelector('#portfolio-panel'),
    '股票圖鑑': document.querySelector('#stocks-panel'),
    '任務成就': document.querySelector('#tasks-panel'),
  };
  if (button.dataset.view === '模擬交易') {
    openTradeDialog();
    return;
  }
  targets[button.dataset.view]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

document.querySelectorAll('.range button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.range button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  toast(`已切換至 ${button.textContent} 區間示意圖`);
}));

if (loaded.status === 'recovered') toast('保存資料格式有誤，已暫以新帳戶開始；確認後的交易會覆寫舊資料。');
else if (loaded.status === 'unavailable') toast('瀏覽器儲存不可用；本次練習不會在重新載入後保留。');
else if (loaded.status === 'migrated-unsaved') toast('舊版帳戶已載入，但瀏覽器未能更新資料版本；下一筆操作後會再次保存。');

populateSymbolOptions();
render();



document.querySelector('#app-status').textContent = '模擬交易功能已就緒';





