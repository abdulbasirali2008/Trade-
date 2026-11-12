// Realistic price simulator used when a live feed is unavailable (offline, blocked, forex without an API key).
// Volatility clustering and short-term drift give tick behaviour that looks like a real market.

const YEAR_SEC = 365 * 24 * 3600;

export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rnd = Math.random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class PriceSim {
  constructor(sym, price, rnd = Math.random) {
    this.sym = sym;
    this.price = price;
    this.rnd = rnd;
    this.volState = 1;
    this.drift = 0;
  }

  step(dtSec) {
    const sigma = this.sym.simVol * Math.sqrt(dtSec / YEAR_SEC);
    this.volState = clamp(this.volState + (1 - this.volState) * 0.03 + gaussian(this.rnd) * 0.08, 0.5, 3);
    this.drift = this.drift * 0.98 + gaussian(this.rnd) * sigma * 0.15;
    this.price *= Math.exp(gaussian(this.rnd) * sigma * this.volState + this.drift);
    return this.price;
  }
}

/** Bid/ask around a mid price using the instrument's typical spread. */
export function quoteFromMid(sym, mid) {
  const half = sym.market === 'forex' ? (sym.spreadPips * sym.pip) / 2 : Math.max(mid * 0.000025, Math.pow(10, -sym.decimals));
  return { bid: mid - half, ask: mid + half, last: mid };
}

/** Candle history that ends at `endPrice`, generated with the same volatility model. */
export function genHistory(sym, endPrice, tfSec, n, nowSec, seed = 1) {
  const rnd = mulberry32(seed + tfSec + sym.id.length * 977);
  const sim = new PriceSim(sym, 1, rnd);
  const sub = 12;
  const dt = tfSec / sub;
  const lastTime = Math.floor(nowSec / tfSec) * tfSec;
  const firstTime = lastTime - (n - 1) * tfSec;
  const bars = [];
  for (let i = 0; i < n; i++) {
    const open = sim.price;
    let hi = open;
    let lo = open;
    for (let k = 0; k < sub; k++) {
      const p = sim.step(dt);
      if (p > hi) hi = p;
      if (p < lo) lo = p;
    }
    const close = sim.price;
    const volume = (0.5 + rnd()) * (1 + ((hi - lo) / open) * 400) * 100;
    bars.push({ time: firstTime + i * tfSec, open, high: hi, low: lo, close, volume });
  }
  const scale = endPrice / bars[bars.length - 1].close;
  for (const b of bars) {
    b.open *= scale;
    b.high *= scale;
    b.low *= scale;
    b.close *= scale;
  }
  return bars;
}

/** Ten-level order book around the current bid/ask. */
export function genBook(sym, bid, ask, rnd = Math.random) {
  const mid = (bid + ask) / 2;
  const step = sym.market === 'crypto' ? Math.max(Math.pow(10, -sym.decimals), mid * 0.00001) : sym.pip;
  const levels = 10;
  const bids = [];
  const asks = [];
  const qtyAt = (i) => {
    const q = (150000 / mid) * (0.5 + rnd() * 1.5) * (1 + i * 0.18);
    return sym.market === 'forex' ? Math.round(q * 8) : Number(q.toFixed(sym.qtyStep < 1 ? 3 : 0));
  };
  for (let i = 0; i < levels; i++) {
    bids.push([bid - i * step, qtyAt(i)]);
    asks.push([ask + i * step, qtyAt(i)]);
  }
  return { bids, asks };
}

/** Builds and updates candles from a stream of prices. */
export class CandleBuilder {
  constructor(tfSec, bars) {
    this.tf = tfSec;
    this.bars = bars;
  }

  push(price, tsSec, volume = 0) {
    const t = Math.floor(tsSec / this.tf) * this.tf;
    const last = this.bars[this.bars.length - 1];
    if (last && t <= last.time) {
      if (price > last.high) last.high = price;
      if (price < last.low) last.low = price;
      last.close = price;
      last.volume += volume;
      return { bar: last, isNew: false };
    }
    const open = last ? last.close : price;
    const bar = { time: t, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume };
    this.bars.push(bar);
    return { bar, isNew: true };
  }
}
