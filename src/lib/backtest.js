// Simple candle-based backtester. Signals are computed on a bar's close and executed at the next bar's open.
// Stop-loss and take-profit are checked inside each bar (if both could trigger, the stop is assumed to hit first).

import { sma, rsi, macd, bollinger } from './indicators.js';

export const STRATEGIES = [
  {
    id: 'sma',
    name: 'Moving average cross',
    desc: 'Long when the fast average is above the slow one, short when it is below. A trend-following idea.',
    params: [
      { key: 'fast', label: 'Fast period', def: 10, min: 2, max: 100, step: 1 },
      { key: 'slow', label: 'Slow period', def: 30, min: 5, max: 300, step: 1 },
    ],
  },
  {
    id: 'rsi',
    name: 'RSI mean reversion',
    desc: 'Buy when RSI drops below the low level, sell when it rises above the high level. Exit near 50.',
    params: [
      { key: 'period', label: 'RSI period', def: 14, min: 2, max: 50, step: 1 },
      { key: 'low', label: 'Buy below', def: 30, min: 5, max: 45, step: 1 },
      { key: 'high', label: 'Sell above', def: 70, min: 55, max: 95, step: 1 },
    ],
  },
  {
    id: 'macd',
    name: 'MACD cross',
    desc: 'Long when the MACD histogram is positive, short when it is negative. A momentum idea.',
    params: [],
  },
  {
    id: 'bb',
    name: 'Bollinger bounce',
    desc: 'Buy when the close falls under the lower band, sell above the upper band. Exit at the middle band.',
    params: [
      { key: 'period', label: 'Period', def: 20, min: 5, max: 100, step: 1 },
      { key: 'mult', label: 'Std. deviations', def: 2, min: 1, max: 4, step: 0.5 },
    ],
  },
  {
    id: 'break',
    name: 'Channel breakout',
    desc: 'Long when the close breaks above the highest high of the last N bars, short below the lowest low.',
    params: [{ key: 'lookback', label: 'Lookback bars', def: 20, min: 5, max: 200, step: 1 }],
  },
];

export const defaultParams = (id) => Object.fromEntries((STRATEGIES.find((s) => s.id === id)?.params || []).map((p) => [p.key, p.def]));

/** Target position (-1, 0, +1) after each bar's close. */
export function signals(id, candles, p, longOnly = false) {
  const close = candles.map((c) => c.close);
  const n = candles.length;
  const out = new Array(n).fill(0);

  if (id === 'sma') {
    const f = sma(close, p.fast);
    const s = sma(close, p.slow);
    for (let i = 0; i < n; i++) out[i] = f[i] != null && s[i] != null ? (f[i] > s[i] ? 1 : -1) : 0;
  } else if (id === 'rsi') {
    const r = rsi(close, p.period);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (r[i] == null) { out[i] = 0; continue; }
      if (state === 0) {
        if (r[i] < p.low) state = 1;
        else if (r[i] > p.high) state = -1;
      } else if (state === 1 && r[i] >= 50) state = 0;
      else if (state === -1 && r[i] <= 50) state = 0;
      out[i] = state;
    }
  } else if (id === 'macd') {
    const m = macd(close);
    for (let i = 0; i < n; i++) out[i] = m.hist[i] == null ? 0 : m.hist[i] > 0 ? 1 : -1;
  } else if (id === 'bb') {
    const b = bollinger(close, p.period, p.mult);
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (b.mid[i] == null) { out[i] = 0; continue; }
      if (close[i] < b.lower[i]) state = 1;
      else if (close[i] > b.upper[i]) state = -1;
      else if (state === 1 && close[i] >= b.mid[i]) state = 0;
      else if (state === -1 && close[i] <= b.mid[i]) state = 0;
      out[i] = state;
    }
  } else if (id === 'break') {
    let state = 0;
    for (let i = 0; i < n; i++) {
      if (i < p.lookback) { out[i] = 0; continue; }
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - p.lookback; j < i; j++) {
        if (candles[j].high > hh) hh = candles[j].high;
        if (candles[j].low < ll) ll = candles[j].low;
      }
      if (close[i] > hh) state = 1;
      else if (close[i] < ll) state = -1;
      out[i] = state;
    }
  }
  return longOnly ? out.map((v) => (v < 0 ? 0 : v)) : out;
}

/**
 * opts: { strategy, params, longOnly, sizePct, slPct, tpPct, feePct, slipPct, startBalance }
 * Percent options are in percent (feePct 0.04 = 0.04 %).
 */
export function runBacktest(candles, opts) {
  const { strategy, params, longOnly = false, sizePct = 100, slPct = 0, tpPct = 0, feePct = 0.04, slipPct = 0.01, startBalance = 10000 } = opts;
  const sig = signals(strategy, candles, params, longOnly);
  const fee = feePct / 100;
  const slip = slipPct / 100;
  let eq = startBalance;
  let pos = null;
  let blockedDir = 0;
  const trades = [];
  const curve = [];

  const close = (price, reason, i) => {
    const d = pos.dir;
    const px = reason === 'tp' ? price : price * (1 - d * slip);
    const gross = d * (px - pos.entry) * pos.qty;
    const fees = (pos.entry * pos.qty + px * pos.qty) * fee;
    const pnl = gross - fees;
    eq += pnl;
    trades.push({ dir: d, entry: pos.entry, exit: px, qty: pos.qty, pnl, fees, ret: pnl / pos.equityAtEntry, reason, openIdx: pos.idx, closeIdx: i, openTime: candles[pos.idx].time, closeTime: candles[i].time });
    if (reason === 'sl' || reason === 'tp') blockedDir = d;
    pos = null;
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i > 0 && eq > 0) {
      const want = sig[i - 1];
      if (blockedDir !== 0 && want !== blockedDir) blockedDir = 0;
      const have = pos ? pos.dir : 0;
      if (want !== have && !(want !== 0 && want === blockedDir)) {
        if (pos) close(c.open, 'signal', i);
        if (want !== 0) {
          const entry = c.open * (1 + want * slip);
          const qty = (eq * (sizePct / 100)) / entry;
          pos = {
            dir: want,
            entry,
            qty,
            idx: i,
            equityAtEntry: eq,
            sl: slPct > 0 ? entry * (1 - (want * slPct) / 100) : null,
            tp: tpPct > 0 ? entry * (1 + (want * tpPct) / 100) : null,
          };
        }
      }
    }
    if (pos) {
      if (pos.dir === 1) {
        if (pos.sl != null && c.low <= pos.sl) close(Math.min(pos.sl, c.open), 'sl', i);
        else if (pos.tp != null && c.high >= pos.tp) close(Math.max(pos.tp, c.open), 'tp', i);
      } else if (pos.sl != null && c.high >= pos.sl) close(Math.max(pos.sl, c.open), 'sl', i);
      else if (pos.tp != null && c.low <= pos.tp) close(Math.min(pos.tp, c.open), 'tp', i);
    }
    const marked = pos ? eq + pos.dir * (c.close - pos.entry) * pos.qty : eq;
    curve.push({ time: c.time, equity: marked });
  }
  if (pos) {
    close(candles[candles.length - 1].close, 'end', candles.length - 1);
    curve[curve.length - 1].equity = eq;
  }

  let peak = -Infinity;
  let maxDd = 0;
  for (const p of curve) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak > 0 ? (peak - p.equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const gp = wins.reduce((a, t) => a + t.pnl, 0);
  const gl = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const first = candles.find((c) => c.close > 0);
  const last = candles[candles.length - 1];
  return {
    trades,
    curve,
    stats: {
      net: eq - startBalance,
      returnPct: ((eq - startBalance) / startBalance) * 100,
      finalEquity: eq,
      count: trades.length,
      winRate: trades.length ? wins.length / trades.length : 0,
      profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
      avgWin: wins.length ? gp / wins.length : 0,
      avgLoss: losses.length ? -gl / losses.length : 0,
      maxDrawdownPct: maxDd * 100,
      fees: trades.reduce((a, t) => a + t.fees, 0),
      buyHoldPct: first && last ? (last.close / first.close - 1) * 100 : 0,
    },
  };
}
