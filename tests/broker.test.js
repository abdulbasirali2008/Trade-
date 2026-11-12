import test from 'node:test';
import assert from 'node:assert/strict';
import { Broker, STOP_OUT_LEVEL } from '../src/lib/broker.js';

function make(quotes, books = {}, now = () => 1_700_000_000_000) {
  const q = { ...quotes };
  const b = new Broker({ getQuote: (id) => q[id], getBook: (id) => books[id], latency: false, rand: () => 0.5, now });
  b.reset(10000);
  return { b, q };
}

const btc = (bid, ask = bid + 1) => ({ bid, ask, last: (bid + ask) / 2 });

test('market buy opens a position with margin, fee and a fill at or above the ask', async () => {
  const { b } = make({ BTCUSDT: btc(100000, 100001) });
  const r = await b.placeMarket({ symbol: 'BTCUSDT', side: 'buy', qty: 0.1, leverage: 10 });
  assert.equal(r.ok, true);
  assert.ok(r.price >= 100001);
  const p = b.state.positions[0];
  assert.equal(p.side, 'long');
  assert.ok(Math.abs(p.margin - (0.1 * r.price) / 10) < 1e-6);
  assert.ok(b.state.balance < 10000, 'taker fee was charged');
  assert.ok(Math.abs(10000 - b.state.balance - 0.1 * r.price * 0.0004) < 1e-6);
});

test('equity uses the exit side of the spread', async () => {
  const { b, q } = make({ BTCUSDT: btc(100000, 100010) });
  await b.placeMarket({ symbol: 'BTCUSDT', side: 'buy', qty: 0.5, leverage: 10 });
  const entry = b.state.positions[0].entry;
  q.BTCUSDT = btc(101000, 101010);
  const m = b.metrics();
  assert.ok(Math.abs(m.upl - 0.5 * (101000 - entry)) < 1e-6);
});

test('rejects an order that needs more margin than is free', async () => {
  const { b } = make({ BTCUSDT: btc(100000) });
  const r = await b.placeMarket({ symbol: 'BTCUSDT', side: 'buy', qty: 5, leverage: 2 });
  assert.equal(r.ok, false);
  assert.equal(b.state.positions.length, 0);
});

test('stop-loss closes the position and books the loss', async () => {
  const { b, q } = make({ BTCUSDT: btc(100000) });
  await b.placeMarket({ symbol: 'BTCUSDT', side: 'buy', qty: 0.5, leverage: 10, sl: 99000 });
  q.BTCUSDT = btc(98900);
  b.onQuote('BTCUSDT');
  assert.equal(b.state.positions.length, 0);
  assert.equal(b.state.history[0].reason, 'sl');
  assert.ok(b.state.history[0].pnl < 0);
  assert.ok(b.state.balance < 10000);
});

test('take-profit closes at the target price', async () => {
  const { b, q } = make({ BTCUSDT: btc(100000) });
  await b.placeMarket({ symbol: 'BTCUSDT', side: 'buy', qty: 0.5, leverage: 10, tp: 101000 });
  q.BTCUSDT = btc(101200);
  b.onQuote('BTCUSDT');
  assert.equal(b.state.positions.length, 0);
  assert.equal(b.state.history[0].reason, 'tp');
  assert.ok(b.state.history[0].pnl > 0);
});

test('limit order rests until the ask reaches the price, then fills as maker', async () => {
  const { b, q } = make({ BTCUSDT: btc(100000) });
  const r = b.placeOrder({ symbol: 'BTCUSDT', side: 'buy', type: 'limit', qty: 0.1, price: 99000, leverage: 5 });
  assert.equal(r.ok, true);
  assert.equal(b.state.orders.length, 1);
  b.onQuote('BTCUSDT');
  assert.equal(b.state.positions.length, 0);
  q.BTCUSDT = btc(98990, 98995);
  b.onQuote('BTCUSDT');
  assert.equal(b.state.orders.length, 0);
  assert.equal(b.state.positions.length, 1);
  assert.equal(b.state.positions[0].entry, 98995);
  assert.ok(Math.abs(b.state.positions[0].fees - 0.1 * 98995 * 0.0002) < 1e-6);
});

test('stop order validation and trigger', async () => {
  const { b, q } = make({ BTCUSDT: btc(100000) });
  assert.equal(b.placeOrder({ symbol: 'BTCUSDT', side: 'buy', type: 'stop', qty: 0.1, price: 99000, leverage: 5 }).ok, false);
  assert.equal(b.placeOrder({ symbol: 'BTCUSDT', side: 'buy', type: 'stop', qty: 0.1, price: 101000, leverage: 5 }).ok, true);
  q.BTCUSDT = btc(101100);
  b.onQuote('BTCUSDT');
  assert.equal(b.state.positions.length, 1);
});

test('stop-out liquidates when margin level falls below the limit', async () => {
  const { b, q } = make({ BTCUSDT: btc(100000) });
  await b.placeMarket({ symbol: 'BTCUSDT', side: 'buy', qty: 0.9, leverage: 10 });
  const m0 = b.metrics();
  assert.ok(m0.level > STOP_OUT_LEVEL);
  q.BTCUSDT = btc(90500);
  b.onQuote('BTCUSDT');
  assert.equal(b.state.positions.length, 0);
  assert.equal(b.state.history[0].reason, 'stopout');
});

test('opposite order reduces, closes and flips (netting)', async () => {
  const { b } = make({ BTCUSDT: btc(100000) });
  await b.placeMarket({ symbol: 'BTCUSDT', side: 'buy', qty: 0.2, leverage: 10 });
  await b.placeMarket({ symbol: 'BTCUSDT', side: 'sell', qty: 0.05, leverage: 10 });
  assert.equal(b.state.positions.length, 1);
  assert.ok(Math.abs(b.state.positions[0].qty - 0.15) < 1e-9);
  await b.placeMarket({ symbol: 'BTCUSDT', side: 'sell', qty: 0.25, leverage: 10 });
  assert.equal(b.state.positions.length, 1);
  assert.equal(b.state.positions[0].side, 'short');
  assert.ok(Math.abs(b.state.positions[0].qty - 0.1) < 1e-9);
});

test('USDJPY profit is converted from yen to USD', async () => {
  const { b, q } = make({ USDJPY: { bid: 150, ask: 150.01, last: 150.005 } });
  await b.placeMarket({ symbol: 'USDJPY', side: 'buy', qty: 100000, leverage: 100 });
  const entry = b.state.positions[0].entry;
  q.USDJPY = { bid: 151, ask: 151.01, last: 151.005 };
  const expected = (100000 * (151 - entry)) / 151;
  assert.ok(Math.abs(b.metrics().upl - expected) < 1e-6);
});

test('forex round trip costs the spread', async () => {
  const { b } = make({ EURUSD: { bid: 1.08, ask: 1.08008, last: 1.08004 } });
  await b.placeMarket({ symbol: 'EURUSD', side: 'buy', qty: 100000, leverage: 50 });
  const pos = b.state.positions[0];
  await b.closePosition(pos.id, 1);
  assert.equal(b.state.positions.length, 0);
  assert.ok(b.state.history[0].pnl < 0, 'spread and slippage make an instant round trip a loss');
  assert.ok(b.state.history[0].pnl > -30);
});

test('crypto funding is charged to longs at the 8 hour boundary', async () => {
  let t = Date.UTC(2025, 0, 1, 7, 59, 0);
  const { b } = make({ BTCUSDT: btc(100000) }, {}, () => t);
  await b.placeMarket({ symbol: 'BTCUSDT', side: 'buy', qty: 0.5, leverage: 10 });
  b.onQuote('BTCUSDT'); // initialise the settlement clock
  const before = b.state.balance;
  t = Date.UTC(2025, 0, 1, 8, 0, 30);
  b.onQuote('BTCUSDT');
  assert.ok(b.state.balance < before);
  assert.ok(b.state.positions[0].funding > 0);
});

test('large crypto orders walk the order book and slip', async () => {
  const book = {
    asks: [[100001, 0.1], [100010, 0.1], [100100, 0.1]],
    bids: [[100000, 0.1], [99990, 0.1], [99900, 0.1]],
  };
  const { b } = make({ BTCUSDT: btc(100000, 100001) }, { BTCUSDT: book });
  const r = await b.placeMarket({ symbol: 'BTCUSDT', side: 'buy', qty: 0.3, leverage: 20 });
  assert.ok(r.price > 100001 + 30, 'fill is worse than the best ask');
});
