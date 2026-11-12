// Instrument definitions and unit maths shared by the feed, broker and UI.

export const TIMEFRAMES = [
  { id: '1m', sec: 60, binance: '1m', td: '1min' },
  { id: '5m', sec: 300, binance: '5m', td: '5min' },
  { id: '15m', sec: 900, binance: '15m', td: '15min' },
  { id: '1h', sec: 3600, binance: '1h', td: '1h' },
  { id: '4h', sec: 14400, binance: '4h', td: '4h' },
  { id: '1d', sec: 86400, binance: '1d', td: '1day' },
];

export const tfById = (id) => TIMEFRAMES.find((t) => t.id === id) || TIMEFRAMES[1];

const crypto = (id, name, base, simPrice, decimals, qtyStep, simVol) => ({
  id,
  name,
  base,
  quote: 'USDT',
  market: 'crypto',
  lotSize: 1, // quantity is in coins
  qtyStep,
  minQty: qtyStep,
  decimals,
  pip: Math.pow(10, -decimals),
  maxLev: 100,
  takerFee: 0.0004, // 0.04 % of notional per side
  makerFee: 0.0002,
  fundingRate: 0.0001, // paid by longs every 8 h (shorts receive)
  spreadPips: 0,
  simPrice,
  simVol,
  stream: id.toLowerCase(),
});

const fx = (id, name, base, quote, simPrice, decimals, pip, spreadPips, swapLong, swapShort, simVol, extra = {}) => ({
  id,
  name,
  base,
  quote,
  market: 'forex',
  lotSize: 100000, // 1 lot = 100,000 units
  qtyStep: 1000, // 0.01 lot
  minQty: 1000,
  decimals,
  pip,
  maxLev: 200,
  takerFee: 0,
  makerFee: 0,
  fundingRate: 0,
  spreadPips,
  swapLong, // daily cost as a fraction of notional (positive = you pay)
  swapShort,
  simPrice,
  simVol,
  td: `${base}/${quote}`,
  ...extra,
});

export const SYMBOLS = [
  crypto('BTCUSDT', 'Bitcoin', 'BTC', 90000, 2, 0.001, 0.5),
  crypto('ETHUSDT', 'Ethereum', 'ETH', 3200, 2, 0.01, 0.65),
  crypto('SOLUSDT', 'Solana', 'SOL', 150, 2, 0.1, 0.85),
  crypto('BNBUSDT', 'BNB', 'BNB', 600, 2, 0.01, 0.55),
  crypto('XRPUSDT', 'XRP', 'XRP', 2.2, 4, 1, 0.9),
  crypto('DOGEUSDT', 'Dogecoin', 'DOGE', 0.18, 5, 10, 1.0),
  crypto('ADAUSDT', 'Cardano', 'ADA', 0.7, 4, 1, 0.9),
  fx('EURUSD', 'Euro / US Dollar', 'EUR', 'USD', 1.08, 5, 0.0001, 0.8, 0.00002, -0.00001, 0.075),
  fx('GBPUSD', 'British Pound / US Dollar', 'GBP', 'USD', 1.27, 5, 0.0001, 1.1, 0.00002, -0.00001, 0.085),
  fx('USDJPY', 'US Dollar / Japanese Yen', 'USD', 'JPY', 150, 3, 0.01, 0.9, -0.00003, 0.00005, 0.095),
  fx('AUDUSD', 'Australian Dollar / US Dollar', 'AUD', 'USD', 0.66, 5, 0.0001, 1.0, 0.00001, -0.00001, 0.09),
  fx('USDCAD', 'US Dollar / Canadian Dollar', 'USD', 'CAD', 1.36, 5, 0.0001, 1.3, 0.00001, 0.00001, 0.07),
  fx('USDCHF', 'US Dollar / Swiss Franc', 'USD', 'CHF', 0.88, 5, 0.0001, 1.4, -0.00001, 0.00003, 0.075),
  fx('XAUUSD', 'Gold / US Dollar', 'XAU', 'USD', 2650, 2, 0.1, 3.0, 0.00006, -0.00002, 0.16, {
    lotSize: 100, // 1 lot = 100 oz
    qtyStep: 1,
    minQty: 1,
    maxLev: 100,
  }),
];

export const SYMBOL_BY_ID = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));
export const getSym = (id) => SYMBOL_BY_ID[id];

const isUsdQuote = (s) => s.quote === 'USD' || s.quote === 'USDT';

/** USD value of one unit of the base asset at this price. */
export function baseToUsd(sym, price) {
  if (sym.base === 'USD') return 1;
  if (isUsdQuote(sym)) return price;
  return price; // cross pairs are not offered
}

/** Multiplier that converts a quote-currency amount into USD. */
export function quoteToUsd(sym, price) {
  if (isUsdQuote(sym)) return 1;
  return price > 0 ? 1 / price : 0; // USD/JPY, USD/CAD, USD/CHF
}

export const notionalUsd = (sym, qty, price) => qty * baseToUsd(sym, price);

/** Gross profit or loss in USD for a position (dir: +1 long, -1 short). */
export const pnlUsd = (sym, qty, entry, exit, dir) => qty * (exit - entry) * dir * quoteToUsd(sym, exit);

/** USD value of a 1 pip move per 1 lot (forex) or per 1 coin (crypto). */
export function pipValueUsd(sym, price) {
  return sym.lotSize * sym.pip * quoteToUsd(sym, price);
}

export const fmtPrice = (sym, p) => (p == null || Number.isNaN(p) ? '–' : Number(p).toFixed(sym.decimals));

export function fmtQty(sym, qty) {
  if (sym.market === 'forex') return `${(qty / sym.lotSize).toFixed(2)} lot`;
  const dec = sym.qtyStep < 1 ? String(sym.qtyStep).split('.')[1].length : 0;
  return `${qty.toFixed(dec)} ${sym.base}`;
}

export function roundQty(sym, qty) {
  const steps = Math.floor(qty / sym.qtyStep + 1e-9);
  const dec = sym.qtyStep < 1 ? String(sym.qtyStep).split('.')[1].length : 0;
  return Number((steps * sym.qtyStep).toFixed(dec));
}

export const fmtUsd = (v, digits = 2) => {
  if (v == null || Number.isNaN(v)) return '–';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
