import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, bollinger } from '../src/lib/indicators.js';
import { genHistory, CandleBuilder } from '../src/lib/sim.js';
import { getSym } from '../src/lib/symbols.js';

test('sma averages the window', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('ema seeds with the sma and then smooths', () => {
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[2], 2);
  assert.ok(Math.abs(e[3] - 3) < 1e-12);
  assert.ok(Math.abs(e[4] - 4) < 1e-12);
});

test('rsi is 100 on a pure uptrend and 0 on a pure downtrend', () => {
  const up = Array.from({ length: 30 }, (_, i) => i + 1);
  const down = up.slice().reverse();
  assert.equal(rsi(up, 14)[29], 100);
  assert.equal(rsi(down, 14)[29], 0);
});

test('macd histogram equals line minus signal', () => {
  const v = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1);
  const m = macd(v);
  const i = 70;
  assert.ok(Math.abs(m.hist[i] - (m.line[i] - m.signal[i])) < 1e-12);
});

test('bollinger bands bracket the mean', () => {
  const v = Array.from({ length: 40 }, (_, i) => 50 + Math.sin(i) * 3);
  const b = bollinger(v, 20, 2);
  assert.ok(b.upper[30] > b.mid[30] && b.lower[30] < b.mid[30]);
});

test('generated history ends at the requested price with sane candles', () => {
  const sym = getSym('EURUSD');
  const bars = genHistory(sym, 1.1, 300, 200, 1_700_000_000, 3);
  assert.equal(bars.length, 200);
  assert.ok(Math.abs(bars[199].close - 1.1) < 1e-9);
  for (const b of bars) assert.ok(b.high >= Math.max(b.open, b.close) - 1e-12 && b.low <= Math.min(b.open, b.close) + 1e-12);
});

test('candle builder rolls over to a new bar', () => {
  const bars = [{ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 0 }];
  const cb = new CandleBuilder(60, bars);
  assert.equal(cb.push(2, 30).isNew, false);
  assert.equal(bars[0].high, 2);
  const r = cb.push(3, 65);
  assert.equal(r.isNew, true);
  assert.equal(bars.length, 2);
  assert.equal(bars[1].open, 2);
});
