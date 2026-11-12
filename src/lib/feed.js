// Market data feed.
//   Crypto : Binance public WebSocket + REST (no API key, includes the real order book).
//   Forex  : Twelve Data WebSocket + REST when the user adds a free API key in Settings.
//   Fallback: realistic simulated ticks, so the app always works offline or when a source is blocked.

import { SYMBOLS, getSym, tfById } from './symbols.js';
import { PriceSim, quoteFromMid, genHistory, genBook, CandleBuilder } from './sim.js';

const BINANCE_REST = ['https://data-api.binance.vision', 'https://api.binance.com'];
const BINANCE_WS = ['wss://data-stream.binance.vision/stream', 'wss://stream.binance.com:9443/stream'];
const LIVE_FRESH_MS = 5000;

const CRYPTO = SYMBOLS.filter((s) => s.market === 'crypto');
const FOREX = SYMBOLS.filter((s) => s.market === 'forex');
const CRYPTO_BY_STREAM = Object.fromEntries(CRYPTO.map((s) => [s.stream, s]));
const FOREX_BY_TD = Object.fromEntries(FOREX.map((s) => [s.td, s]));

async function fetchJson(url, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export class MarketFeed {
  constructor() {
    this.quotes = {};
    this.books = {};
    this.sims = {};
    this.lastLive = {};
    this.status = { crypto: 'connecting', forex: 'sim', detail: '' };
    this.listeners = { quote: new Set(), book: new Set(), bar: new Set(), ui: new Set() };
    this.uiVersion = 0;
    this._uiPending = false;
    this.active = { symbol: 'BTCUSDT', tf: '5m' };
    this.builder = null;
    this.ws = null;
    this.wsIdx = 0;
    this.msgId = 1;
    this.tdKey = '';
    this.tdWs = null;
    this._timers = [];
    this.started = false;
    this._lastSim = Date.now();

    for (const sym of SYMBOLS) {
      this.sims[sym.id] = new PriceSim(sym, sym.simPrice);
      const qt = quoteFromMid(sym, sym.simPrice);
      this.quotes[sym.id] = { ...qt, ts: Date.now(), src: 'sim', open24: sym.simPrice };
    }
  }

  // ---------- subscriptions ----------
  _sub(kind, fn) {
    this.listeners[kind].add(fn);
    return () => this.listeners[kind].delete(fn);
  }
  onQuote(fn) { return this._sub('quote', fn); }
  onBook(fn) { return this._sub('book', fn); }
  onBar(fn) { return this._sub('bar', fn); }
  subscribeUi = (fn) => this._sub('ui', fn);
  getUiVersion = () => this.uiVersion;

  touchUi() {
    if (this._uiPending) return;
    this._uiPending = true;
    setTimeout(() => {
      this._uiPending = false;
      this.uiVersion++;
      this.listeners.ui.forEach((f) => f());
    }, 250);
  }

  // ---------- lifecycle ----------
  start({ tdKey = '' } = {}) {
    if (this.started) return;
    this.started = true;
    this.tdKey = tdKey;
    this._timers.push(setInterval(() => this._simTick(), 500));
    this.seedCrypto().finally(() => this.connectBinance());
    this.loadForexBases();
    if (this.tdKey) this.connectTwelve();
  }

  setTdKey(key) {
    this.tdKey = (key || '').trim();
    if (this.tdWs) {
      try { this.tdWs.close(); } catch (e) { /* ignore */ }
      this.tdWs = null;
    }
    if (this.tdKey && this.started) this.connectTwelve();
    else this.status.forex = 'sim';
    this.touchUi();
  }

  setActive(symbolId, tfId) {
    const prev = this.active;
    const prevStreams = this.activeStreams();
    this.active = { symbol: symbolId, tf: tfId };
    if (prev.symbol !== symbolId || prev.tf !== tfId) this.builder = null;
    const nextStreams = this.activeStreams();
    if (this.ws && this.ws.readyState === 1) {
      const drop = prevStreams.filter((s) => !nextStreams.includes(s));
      const add = nextStreams.filter((s) => !prevStreams.includes(s));
      if (drop.length) this.ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: drop, id: this.msgId++ }));
      if (add.length) this.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: add, id: this.msgId++ }));
    }
    this.touchUi();
  }

  activeStreams() {
    const sym = getSym(this.active.symbol);
    if (!sym || sym.market !== 'crypto') return [];
    return [`${sym.stream}@kline_${tfById(this.active.tf).binance}`, `${sym.stream}@depth10@100ms`];
  }

  /** Let the feed extend these candles with live ticks (non-Binance-kline sources). */
  attachBars(symbolId, tfId, bars) {
    if (symbolId !== this.active.symbol || tfId !== this.active.tf) return;
    this.builder = new CandleBuilder(tfById(tfId).sec, bars);
  }

  // ---------- quotes ----------
  setQuote(id, bid, ask, last, src) {
    const prev = this.quotes[id] || {};
    const q = { ...prev, bid, ask, last, ts: Date.now(), src };
    if (q.open24 == null) q.open24 = last;
    this.quotes[id] = q;
    if (src === 'live') {
      this.lastLive[id] = Date.now();
      if (this.sims[id]) this.sims[id].price = last;
    }
    const sym = getSym(id);
    if (id === this.active.symbol && this.builder && !(sym.market === 'crypto' && src === 'live')) {
      const { bar } = this.builder.push(last, Date.now() / 1000, 0);
      this.listeners.bar.forEach((fn) => fn(id, this.active.tf, bar));
    }
    this.listeners.quote.forEach((fn) => fn(id, q));
    this.touchUi();
  }

  isLive(id) {
    return Date.now() - (this.lastLive[id] || 0) < LIVE_FRESH_MS;
  }

  _simTick() {
    const now = Date.now();
    const dt = Math.min(5, (now - this._lastSim) / 1000);
    this._lastSim = now;
    for (const sym of SYMBOLS) {
      if (this.isLive(sym.id)) continue;
      const mid = this.sims[sym.id].step(dt);
      const { bid, ask, last } = quoteFromMid(sym, mid);
      this.setQuote(sym.id, bid, ask, last, 'sim');
    }
    const a = getSym(this.active.symbol);
    const q = this.quotes[a.id];
    if (a.market === 'crypto' && q.src === 'sim') {
      this.books[a.id] = genBook(a, q.bid, q.ask);
      this.listeners.book.forEach((fn) => fn(a.id, this.books[a.id]));
    }
  }

  // ---------- Binance ----------
  async seedCrypto() {
    const ids = CRYPTO.map((s) => s.id);
    for (const host of BINANCE_REST) {
      try {
        const rows = await fetchJson(`${host}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(ids))}`, 6000);
        for (const r of rows) {
          const sym = getSym(r.symbol);
          if (!sym) continue;
          const last = +r.lastPrice;
          const bid = +r.bidPrice || last;
          const ask = +r.askPrice || last;
          this.quotes[sym.id] = { ...this.quotes[sym.id], bid, ask, last, open24: +r.openPrice, high24: +r.highPrice, low24: +r.lowPrice, ts: Date.now(), src: 'sim' };
          this.sims[sym.id].price = last;
        }
        return;
      } catch (e) { /* try next host */ }
    }
  }

  connectBinance() {
    const url = BINANCE_WS[this.wsIdx % BINANCE_WS.length];
    const streams = [];
    for (const s of CRYPTO) streams.push(`${s.stream}@bookTicker`, `${s.stream}@miniTicker`);
    streams.push(...this.activeStreams());
    let ws;
    try {
      ws = new WebSocket(`${url}?streams=${streams.join('/')}`);
    } catch (e) {
      this._binanceRetry(false);
      return;
    }
    this.ws = ws;
    let opened = false;
    const timeout = setTimeout(() => { if (!opened) { try { ws.close(); } catch (e) { /* ignore */ } } }, 7000);
    ws.onopen = () => {
      opened = true;
      clearTimeout(timeout);
      this.status.crypto = 'live';
      this.status.detail = 'Binance';
      this.touchUi();
    };
    ws.onmessage = (ev) => this._onBinance(ev.data);
    ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (this.ws === ws) this.ws = null;
      this._binanceRetry(opened);
    };
  }

  _binanceRetry(wasOpen) {
    if (!wasOpen) this.wsIdx++;
    this.status.crypto = wasOpen ? 'reconnecting' : 'sim';
    this.touchUi();
    this._timers.push(setTimeout(() => this.connectBinance(), wasOpen ? 2000 : 15000));
  }

  _onBinance(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg.stream || !msg.data) return;
    const [name, type] = msg.stream.split('@');
    const sym = CRYPTO_BY_STREAM[name];
    if (!sym) return;
    const d = msg.data;
    if (type === 'bookTicker') {
      const bid = +d.b;
      const ask = +d.a;
      if (bid > 0 && ask > 0) this.setQuote(sym.id, bid, ask, (bid + ask) / 2, 'live');
    } else if (type === 'miniTicker') {
      const q = this.quotes[sym.id];
      if (q) { q.open24 = +d.o; q.high24 = +d.h; q.low24 = +d.l; }
    } else if (type && type.startsWith('kline')) {
      const k = d.k;
      if (sym.id === this.active.symbol && k.i === tfById(this.active.tf).binance) {
        const bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
        this.listeners.bar.forEach((fn) => fn(sym.id, this.active.tf, bar));
      }
    } else if (type && type.startsWith('depth')) {
      this.books[sym.id] = { bids: d.bids.map((x) => [+x[0], +x[1]]), asks: d.asks.map((x) => [+x[0], +x[1]]) };
      this.listeners.book.forEach((fn) => fn(sym.id, this.books[sym.id]));
    }
  }

  async _binanceKlines(sym, tf, limit) {
    for (const host of BINANCE_REST) {
      try {
        const rows = await fetchJson(`${host}/api/v3/klines?symbol=${sym.id}&interval=${tf.binance}&limit=${limit}`);
        return rows.map((k) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
      } catch (e) { /* next host */ }
    }
    throw new Error('Binance klines unavailable');
  }

  // ---------- forex ----------
  async loadForexBases() {
    try {
      const data = await fetchJson('https://open.er-api.com/v6/latest/USD', 8000);
      const r = data.rates || {};
      const base = {
        EURUSD: r.EUR && 1 / r.EUR,
        GBPUSD: r.GBP && 1 / r.GBP,
        AUDUSD: r.AUD && 1 / r.AUD,
        USDJPY: r.JPY,
        USDCAD: r.CAD,
        USDCHF: r.CHF,
        XAUUSD: r.XAU && 1 / r.XAU,
      };
      for (const [id, price] of Object.entries(base)) {
        if (!price || !Number.isFinite(price) || this.isLive(id)) continue;
        this.sims[id].price = price;
        const qt = quoteFromMid(getSym(id), price);
        this.quotes[id] = { ...this.quotes[id], ...qt, open24: price };
      }
      this.status.detail = 'Forex reference rates: open.er-api.com';
      this.touchUi();
    } catch (e) { /* keep built-in reference prices */ }
  }

  connectTwelve() {
    if (!this.tdKey) return;
    let ws;
    try {
      ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(this.tdKey)}`);
    } catch (e) { return; }
    this.tdWs = ws;
    let beat = null;
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: FOREX.map((s) => s.td).join(',') } }));
      beat = setInterval(() => { try { ws.send(JSON.stringify({ action: 'heartbeat' })); } catch (e) { /* ignore */ } }, 10000);
      this.status.forex = 'connecting';
      this.touchUi();
    };
    ws.onmessage = (ev) => {
      let d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.event === 'price') {
        const sym = FOREX_BY_TD[d.symbol];
        const mid = +d.price;
        if (sym && mid > 0) {
          const { bid, ask, last } = quoteFromMid(sym, mid);
          this.status.forex = 'live';
          this.setQuote(sym.id, bid, ask, last, 'live');
        }
      }
    };
    const stop = () => {
      if (beat) clearInterval(beat);
      if (this.tdWs === ws) {
        this.tdWs = null;
        this.status.forex = 'sim';
        this.touchUi();
        if (this.tdKey) this._timers.push(setTimeout(() => this.connectTwelve(), 10000));
      }
    };
    ws.onclose = stop;
    ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
  }

  async _twelveSeries(sym, tf, limit) {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym.td)}&interval=${tf.td}&outputsize=${limit}&apikey=${encodeURIComponent(this.tdKey)}`;
    const data = await fetchJson(url, 10000);
    if (!data.values) throw new Error(data.message || 'No data');
    return data.values
      .map((v) => {
        const iso = v.datetime.length === 10 ? `${v.datetime}T00:00:00Z` : `${v.datetime.replace(' ', 'T')}Z`;
        return { time: Math.floor(Date.parse(iso) / 1000), open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +(v.volume || 0) };
      })
      .reverse();
  }

  // ---------- history ----------
  async getCandles(symbolId, tfId, limit = 500) {
    const sym = getSym(symbolId);
    const tf = tfById(tfId);
    if (sym.market === 'crypto') {
      try {
        const bars = await this._binanceKlines(sym, tf, limit);
        if (bars.length) return bars;
      } catch (e) { /* fall through to simulation */ }
    } else if (this.tdKey) {
      try {
        const bars = await this._twelveSeries(sym, tf, limit);
        if (bars.length) return bars;
      } catch (e) { /* fall through to simulation */ }
    }
    const q = this.quotes[symbolId];
    return genHistory(sym, q ? q.last : sym.simPrice, tf.sec, limit, Date.now() / 1000, 7);
  }

  /** Human-readable data source for the UI. */
  sourceLabel(symbolId) {
    const sym = getSym(symbolId);
    const q = this.quotes[symbolId];
    if (q && q.src === 'live') return sym.market === 'crypto' ? 'Live · Binance' : 'Live · Twelve Data';
    return 'Simulated';
  }
}
