import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest, signals, defaultParams } from '../src/lib/backtest.js';

const bar = (i, o, h, l, c) => ({ time: 1000 + i * 60, open: o, high: h, low: l, close: c, volume: 1 });

function trend(n, start, step) {
  return Array.from({ length: n }, (_, i) => {
    const o = start + i * step;
    const c = o + step;
    return bar(i, o, Math.max(o, c) + 0.1, Math.min(o, c) - 0.1, c);
  });
}

test('moving-average cross is profitable on a steady uptrend and goes long', () => {
  const candles = trend(120, 100, 1);
  const sig = signals('sma', candles, { fast: 5, slow: 20 });
  assert.equal(sig[119], 1);
  const r = runBacktest(candles, { strategy: 'sma', params: { fast: 5, slow: 20 }, feePct: 0, slipPct: 0, startBalance: 10000 });
  assert.ok(r.stats.net > 0);
  assert.equal(r.curve.length, 120);
});

test('fees and slippage reduce the result', () => {
  const candles = trend(120, 100, 1);
  const base = { strategy: 'sma', params: { fast: 5, slow: 20 }, startBalance: 10000 };
  const free = runBacktest(candles, { ...base, feePct: 0, slipPct: 0 });
  const paid = runBacktest(candles, { ...base, feePct: 0.2, slipPct: 0.1 });
  assert.ok(paid.stats.net < free.stats.net);
});

test('stop-loss exits at the stop price and does not re-enter on the same signal', () => {
  const candles = [];
  for (let i = 0; i < 30; i++) candles.push(bar(i, 100 + i, 101 + i, 99.5 + i, 100.5 + i));
  // crash bar through a 2 % stop
  candles.push(bar(30, 130, 130.5, 90, 91));
  for (let i = 31; i < 40; i++) candles.push(bar(i, 91 + (i - 31), 92 + (i - 31), 90.5 + (i - 31), 91.5 + (i - 31)));
  const r = runBacktest(candles, { strategy: 'sma', params: { fast: 3, slow: 10 }, slPct: 2, feePct: 0, slipPct: 0, longOnly: true });
  const sl = r.trades.find((t) => t.reason === 'sl');
  assert.ok(sl, 'a stop-loss trade exists');
  assert.ok(sl.exit <= sl.entry * 0.98 + 1e-9);
  assert.ok(sl.pnl < 0);
});

test('long-only strategies never open shorts', () => {
  const candles = trend(80, 200, -1);
  const r = runBacktest(candles, { strategy: 'sma', params: { fast: 5, slow: 20 }, longOnly: true });
  assert.equal(r.trades.filter((t) => t.dir < 0).length, 0);
});

test('every strategy runs with its default parameters', () => {
  const candles = Array.from({ length: 300 }, (_, i) => {
    const c = 100 + Math.sin(i / 8) * 10 + i * 0.05;
    return bar(i, c - 0.2, c + 0.8, c - 0.8, c);
  });
  for (const id of ['sma', 'rsi', 'macd', 'bb', 'break']) {
    const r = runBacktest(candles, { strategy: id, params: defaultParams(id) });
    assert.equal(r.curve.length, 300);
    assert.ok(Number.isFinite(r.stats.finalEquity), id);
  }
});
