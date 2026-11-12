// Paper-trading broker. Orders are matched against live bid/ask prices (and the order book for crypto),
// with spread, slippage, latency, fees, funding/swap, margin and stop-out, so fills behave like a real account.
// Only the balance is virtual. One position per instrument (netting): an opposite order reduces, closes or flips it.

import { getSym, notionalUsd, pnlUsd, quoteToUsd, roundQty } from './symbols.js';

const STORAGE_KEY = 'trade-academy-v1';
export const STOP_OUT_LEVEL = 0.5; // positions are force-closed when equity < 50 % of used margin
const LATENCY_MS = [120, 380];
const HOUR = 3600e3;
const DAY = 24 * HOUR;

export function defaultState(startBalance = 10000) {
  return {
    startBalance,
    balance: startBalance,
    positions: [],
    orders: [],
    history: [],
    journal: {},
    notes: [],
    log: [],
    nextId: 1,
    funding: { crypto: 0, forex: 0 },
    createdAt: Date.now(),
  };
}

export class Broker {
  constructor({ getQuote, getBook = () => undefined, storage = null, now = () => Date.now(), rand = Math.random, latency = true }) {
    this.getQuote = getQuote;
    this.getBook = getBook;
    this.storage = storage;
    this.now = now;
    this.rand = rand;
    this.latency = latency;
    this.version = 0;
    this.listeners = new Set();
    this.eventListeners = new Set();
    this._saveTimer = null;
    this._lastSettleCheck = 0;
    this._warned = false;
    this.state = this._load() || defaultState();
  }

  // ---------- plumbing ----------
  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  onEvent(fn) {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  _emit() {
    this.version++;
    this.listeners.forEach((f) => f());
    this._scheduleSave();
  }

  _event(type, msg) {
    const ev = { id: `${this.now()}-${Math.floor(this.rand() * 1e6)}`, ts: this.now(), type, msg };
    this.state.log.unshift(ev);
    if (this.state.log.length > 60) this.state.log.length = 60;
    this.eventListeners.forEach((f) => f(ev));
  }

  _id() {
    return this.state.nextId++;
  }

  _load() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.positions) || typeof s.balance !== 'number') return null;
      return { ...defaultState(s.startBalance || 10000), ...s };
    } catch (e) {
      return null;
    }
  }

  _scheduleSave() {
    if (!this.storage || this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try { this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch (e) { /* storage full or blocked */ }
    }, 600);
  }

  flush() {
    if (!this.storage) return;
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch (e) { /* ignore */ }
  }

  reset(startBalance = 10000) {
    this.state = defaultState(startBalance);
    this._warned = false;
    this._event('info', `Account reset with ${startBalance.toLocaleString('en-US')} USD.`);
    this._emit();
  }

  // ---------- account maths ----------
  positionFor(symbolId) {
    return this.state.positions.find((p) => p.symbol === symbolId);
  }

  upl(p, q = this.getQuote(p.symbol)) {
    const sym = getSym(p.symbol);
    const exit = p.side === 'long' ? q.bid : q.ask;
    return pnlUsd(sym, p.qty, p.entry, exit, p.side === 'long' ? 1 : -1);
  }

  metrics() {
    let upl = 0;
    let used = 0;
    for (const p of this.state.positions) {
      upl += this.upl(p);
      used += p.margin;
    }
    const equity = this.state.balance + upl;
    return {
      balance: this.state.balance,
      upl,
      equity,
      used,
      free: equity - used,
      level: used > 0 ? equity / used : Infinity, // margin level as a ratio, 1 = 100 %
    };
  }

  /** Approximate price at which this position would be force-closed. */
  liqPrice(p) {
    const sym = getSym(p.symbol);
    const m = this.metrics();
    const allowed = m.equity - STOP_OUT_LEVEL * m.used;
    const q = this.getQuote(p.symbol);
    const unit = p.qty * quoteToUsd(sym, q.last);
    if (unit <= 0) return null;
    const cur = p.side === 'long' ? q.bid : q.ask;
    const move = allowed / unit;
    const liq = p.side === 'long' ? cur - move : cur + move;
    return liq > 0 ? liq : null;
  }

  // ---------- fills ----------
  fillPrice(sym, side, qty) {
    const q = this.getQuote(sym.id);
    const ref = side === 'buy' ? q.ask : q.bid;
    const book = this.getBook(sym.id);
    const sign = side === 'buy' ? 1 : -1;
    if (book && sym.market === 'crypto') {
      const levels = side === 'buy' ? book.asks : book.bids;
      if (levels && levels.length) {
        let remaining = qty;
        let cost = 0;
        let depth = 0;
        for (const [price, size] of levels) {
          depth += size;
          const take = Math.min(remaining, size);
          cost += take * price;
          remaining -= take;
        }
        if (remaining > 1e-12) {
          // Order is bigger than the visible book: price keeps moving against you.
          const worst = levels[levels.length - 1][0];
          const penalty = 1 + sign * 0.0005 * (1 + (remaining / Math.max(depth, 1e-9)) * 10);
          cost += remaining * worst * penalty;
        }
        const px = cost / qty;
        return side === 'buy' ? Math.max(px, q.ask) : Math.min(px, q.bid);
      }
    }
    let slip;
    if (sym.market === 'forex') {
      const lots = qty / sym.lotSize;
      slip = (this.rand() * 0.25 + Math.max(0, lots - 3) * 0.05) * sym.pip;
    } else {
      const notional = qty * ref;
      slip = ref * (this.rand() * 0.00008 + (notional / 2e6) * 0.0005);
    }
    return ref + sign * slip;
  }

  // ---------- validation ----------
  validate({ symbol, side, qty, leverage, type = 'market', price, sl, tp }) {
    const sym = getSym(symbol);
    if (!sym) return 'Unknown instrument.';
    if (!(qty >= sym.minQty - 1e-12)) return `Minimum size is ${sym.minQty} ${sym.market === 'forex' ? 'units (0.01 lot)' : sym.base}.`;
    if (!(leverage >= 1) || leverage > sym.maxLev) return `Leverage must be between 1x and ${sym.maxLev}x.`;
    const q = this.getQuote(symbol);
    if (!q) return 'No price available.';
    if (type === 'limit' || type === 'stop') {
      if (!(price > 0)) return 'Enter a valid price.';
      if (type === 'stop' && side === 'buy' && price <= q.ask) return 'A buy stop must be above the current price.';
      if (type === 'stop' && side === 'sell' && price >= q.bid) return 'A sell stop must be below the current price.';
    }
    const ref = type === 'market' || !price ? (side === 'buy' ? q.ask : q.bid) : price;
    if (sl && (side === 'buy' ? sl >= ref : sl <= ref)) return side === 'buy' ? 'Stop-loss must be below the entry price.' : 'Stop-loss must be above the entry price.';
    if (tp && (side === 'buy' ? tp <= ref : tp >= ref)) return side === 'buy' ? 'Take-profit must be above the entry price.' : 'Take-profit must be below the entry price.';
    return null;
  }

  // ---------- market orders ----------
  placeMarket(req) {
    const err = this.validate({ ...req, type: 'market' });
    if (err) {
      this._event('reject', err);
      this._emit();
      return Promise.resolve({ ok: false, error: err });
    }
    return new Promise((resolve) => {
      const run = () => resolve(this._executeMarket(req));
      if (this.latency) setTimeout(run, LATENCY_MS[0] + this.rand() * (LATENCY_MS[1] - LATENCY_MS[0]));
      else run();
    });
  }

  _executeMarket(req) {
    const sym = getSym(req.symbol);
    const price = this.fillPrice(sym, req.side, req.qty);
    return this._applyFill(req, price, false);
  }

  /** Apply a fill to the account. Handles opening, adding, reducing, closing and flipping. */
  _applyFill(req, price, isMaker) {
    const sym = getSym(req.symbol);
    const pos = this.positionFor(sym.id);
    const feeRate = isMaker ? sym.makerFee : sym.takerFee;
    const sideWord = req.side === 'buy' ? 'Buy' : 'Sell';
    const opposite = pos && ((pos.side === 'long' && req.side === 'sell') || (pos.side === 'short' && req.side === 'buy'));
    let remaining = req.qty;

    if (opposite) {
      const closeQty = Math.min(remaining, pos.qty);
      this._reduce(pos, closeQty, price, 'manual', isMaker);
      remaining = roundQty(sym, remaining - closeQty);
      if (remaining < sym.minQty * 0.999) remaining = 0;
      this._event('fill', `${sideWord} ${closeQty} ${sym.id} closed at ${price.toFixed(sym.decimals)}`);
    }

    if (remaining > 0 && !req.reduceOnly) {
      const notional = notionalUsd(sym, remaining, price);
      const margin = notional / req.leverage;
      const fee = notional * feeRate;
      const m = this.metrics();
      if (margin + fee > m.free + 1e-9) {
        const msg = `Rejected: not enough free margin for ${sym.id} (needs ${(margin + fee).toFixed(2)} USD, free ${Math.max(0, m.free).toFixed(2)} USD).`;
        this._event('reject', msg);
        this._emit();
        return { ok: false, error: msg };
      }
      const cur = this.positionFor(sym.id);
      this.state.balance -= fee;
      if (cur) {
        const total = cur.qty + remaining;
        cur.entry = (cur.entry * cur.qty + price * remaining) / total;
        cur.qty = total;
        cur.margin += margin;
        cur.fees += fee;
        cur.leverage = Math.round(notionalUsd(sym, cur.qty, cur.entry) / cur.margin);
        if (req.sl) cur.sl = req.sl;
        if (req.tp) cur.tp = req.tp;
      } else {
        this.state.positions.push({
          id: this._id(),
          symbol: sym.id,
          side: req.side === 'buy' ? 'long' : 'short',
          qty: remaining,
          entry: price,
          leverage: req.leverage,
          margin,
          sl: req.sl || null,
          tp: req.tp || null,
          openedAt: this.now(),
          fees: fee,
          funding: 0,
        });
      }
      this._event('fill', `${sideWord} ${remaining} ${sym.id} filled at ${price.toFixed(sym.decimals)}`);
    }
    this._emit();
    return { ok: true, price };
  }

  /** Close part or all of a position at `exitPrice`, booking profit, fees and funding into history. */
  _reduce(pos, qty, exitPrice, reason, isMaker = false) {
    const sym = getSym(pos.symbol);
    qty = Math.min(qty, pos.qty);
    const dir = pos.side === 'long' ? 1 : -1;
    const gross = pnlUsd(sym, qty, pos.entry, exitPrice, dir);
    const fee = notionalUsd(sym, qty, exitPrice) * (isMaker ? sym.makerFee : sym.takerFee);
    const frac = qty / pos.qty;
    const openFees = pos.fees * frac;
    const funding = pos.funding * frac;
    this.state.balance += gross - fee;
    this.state.history.unshift({
      id: this._id(),
      symbol: pos.symbol,
      side: pos.side,
      qty,
      entry: pos.entry,
      exit: exitPrice,
      gross,
      fees: openFees + fee,
      funding,
      pnl: gross - fee - openFees - funding,
      leverage: pos.leverage,
      openedAt: pos.openedAt,
      closedAt: this.now(),
      reason,
    });
    if (this.state.history.length > 500) this.state.history.length = 500;
    pos.qty -= qty;
    pos.margin -= pos.margin * frac;
    pos.fees -= openFees;
    pos.funding -= funding;
    if (pos.qty <= sym.minQty * 0.001) {
      this.state.positions = this.state.positions.filter((p) => p.id !== pos.id);
    }
  }

  closePosition(id, fraction = 1) {
    const pos = this.state.positions.find((p) => p.id === id);
    if (!pos) return Promise.resolve({ ok: false, error: 'Position not found.' });
    const sym = getSym(pos.symbol);
    let qty = fraction >= 0.999 ? pos.qty : roundQty(sym, pos.qty * fraction);
    if (qty < sym.minQty) qty = pos.qty;
    return this.placeMarket({
      symbol: pos.symbol,
      side: pos.side === 'long' ? 'sell' : 'buy',
      qty,
      leverage: pos.leverage,
      reduceOnly: true,
    });
  }

  setStops(id, { sl, tp }) {
    const pos = this.state.positions.find((p) => p.id === id);
    if (!pos) return { ok: false, error: 'Position not found.' };
    const q = this.getQuote(pos.symbol);
    const long = pos.side === 'long';
    if (sl && (long ? sl >= q.bid : sl <= q.ask)) return { ok: false, error: long ? 'Stop-loss must be below the current price.' : 'Stop-loss must be above the current price.' };
    if (tp && (long ? tp <= q.ask : tp >= q.bid)) return { ok: false, error: long ? 'Take-profit must be above the current price.' : 'Take-profit must be below the current price.' };
    pos.sl = sl || null;
    pos.tp = tp || null;
    this._emit();
    return { ok: true };
  }

  // ---------- pending orders ----------
  placeOrder(req) {
    const err = this.validate(req);
    if (err) {
      this._event('reject', err);
      this._emit();
      return { ok: false, error: err };
    }
    const sym = getSym(req.symbol);
    const q = this.getQuote(req.symbol);
    // A limit order that is already marketable executes immediately as a taker.
    if (req.type === 'limit' && ((req.side === 'buy' && req.price >= q.ask) || (req.side === 'sell' && req.price <= q.bid))) {
      this.placeMarket(req);
      return { ok: true, immediate: true };
    }
    const order = {
      id: this._id(),
      symbol: sym.id,
      side: req.side,
      type: req.type,
      qty: req.qty,
      price: req.price,
      leverage: req.leverage,
      sl: req.sl || null,
      tp: req.tp || null,
      createdAt: this.now(),
    };
    this.state.orders.push(order);
    this._event('info', `${req.type === 'limit' ? 'Limit' : 'Stop'} ${req.side} ${req.qty} ${sym.id} at ${req.price.toFixed(sym.decimals)} placed.`);
    this._emit();
    return { ok: true, order };
  }

  cancelOrder(id) {
    const before = this.state.orders.length;
    this.state.orders = this.state.orders.filter((o) => o.id !== id);
    if (this.state.orders.length !== before) {
      this._event('info', 'Order cancelled.');
      this._emit();
    }
  }

  // ---------- price events ----------
  /** Called for every new quote. Triggers pending orders, SL/TP, stop-out and funding. */
  onQuote(symbolId) {
    const q = this.getQuote(symbolId);
    if (!q) return;
    const sym = getSym(symbolId);
    let changed = false;

    for (const o of [...this.state.orders]) {
      if (o.symbol !== symbolId) continue;
      let fill = null;
      let maker = false;
      if (o.type === 'limit') {
        if (o.side === 'buy' && q.ask <= o.price) { fill = Math.min(o.price, q.ask); maker = true; }
        if (o.side === 'sell' && q.bid >= o.price) { fill = Math.max(o.price, q.bid); maker = true; }
      } else if (o.type === 'stop') {
        if (o.side === 'buy' && q.ask >= o.price) fill = this.fillPrice(sym, 'buy', o.qty);
        if (o.side === 'sell' && q.bid <= o.price) fill = this.fillPrice(sym, 'sell', o.qty);
      }
      if (fill != null) {
        this.state.orders = this.state.orders.filter((x) => x.id !== o.id);
        this._applyFill(o, fill, maker);
        changed = true;
      }
    }

    const pos = this.positionFor(symbolId);
    if (pos) {
      const long = pos.side === 'long';
      if (pos.sl && (long ? q.bid <= pos.sl : q.ask >= pos.sl)) {
        const px = this.fillPrice(sym, long ? 'sell' : 'buy', pos.qty);
        this._event('sl', `Stop-loss hit on ${sym.id} (${pos.side}) at ${px.toFixed(sym.decimals)}`);
        this._reduce(pos, pos.qty, px, 'sl', false);
        changed = true;
      } else if (pos.tp && (long ? q.bid >= pos.tp : q.ask <= pos.tp)) {
        const px = long ? Math.max(pos.tp, q.bid) : Math.min(pos.tp, q.ask);
        this._event('tp', `Take-profit hit on ${sym.id} (${pos.side}) at ${px.toFixed(sym.decimals)}`);
        this._reduce(pos, pos.qty, px, 'tp', true);
        changed = true;
      }
    }

    if (this.state.positions.length) {
      if (this._checkStopOut()) changed = true;
      this._warnMargin();
    }
    if (this._settle()) changed = true;
    if (changed) this._emit();
  }

  _warnMargin() {
    const m = this.metrics();
    if (m.level < 1 && !this._warned) {
      this._warned = true;
      this._event('warn', `Margin call: margin level is ${(m.level * 100).toFixed(0)} %. Positions are closed automatically below ${STOP_OUT_LEVEL * 100} %.`);
    } else if (m.level >= 1.2) this._warned = false;
  }

  _checkStopOut() {
    let acted = false;
    for (let guard = 0; guard < 20; guard++) {
      const m = this.metrics();
      if (!this.state.positions.length || m.used <= 0 || m.equity / m.used >= STOP_OUT_LEVEL) break;
      let worst = null;
      let worstPnl = Infinity;
      for (const p of this.state.positions) {
        const u = this.upl(p);
        if (u < worstPnl) { worstPnl = u; worst = p; }
      }
      const sym = getSym(worst.symbol);
      const px = this.fillPrice(sym, worst.side === 'long' ? 'sell' : 'buy', worst.qty);
      this._event('stopout', `Stop-out: ${sym.id} ${worst.side} was liquidated at ${px.toFixed(sym.decimals)}.`);
      this._reduce(worst, worst.qty, px, 'stopout', false);
      acted = true;
    }
    if (!this.state.positions.length && this.state.balance < 0) {
      this.state.balance = 0;
      this._event('warn', 'Account balance reached zero. Reset the account to start again.');
    }
    return acted;
  }

  /** Crypto funding every 8 h (00/08/16 UTC) and forex rollover at 22:00 UTC (triple on Wednesday). */
  _settle() {
    const now = this.now();
    if (now - this._lastSettleCheck < 1000) return false;
    this._lastSettleCheck = now;
    const f = this.state.funding;
    const cryptoB = Math.floor(now / (8 * HOUR)) * 8 * HOUR;
    const forexB = Math.floor((now - 22 * HOUR) / DAY) * DAY + 22 * HOUR;
    if (!f.crypto) f.crypto = cryptoB;
    if (!f.forex) f.forex = forexB;
    let changed = false;
    for (let n = 0; f.crypto < cryptoB && n < 100; n++) {
      f.crypto += 8 * HOUR;
      changed = this._charge('crypto', f.crypto) || changed;
    }
    for (let n = 0; f.forex < forexB && n < 100; n++) {
      f.forex += DAY;
      changed = this._charge('forex', f.forex) || changed;
    }
    return changed;
  }

  _charge(market, boundary) {
    let any = false;
    for (const p of this.state.positions) {
      const sym = getSym(p.symbol);
      if (sym.market !== market || p.openedAt >= boundary) continue;
      const q = this.getQuote(p.symbol);
      const notional = notionalUsd(sym, p.qty, q.last);
      let amount;
      if (market === 'crypto') {
        amount = notional * sym.fundingRate * (p.side === 'long' ? 1 : -1);
      } else {
        amount = notional * (p.side === 'long' ? sym.swapLong : sym.swapShort);
        if (new Date(boundary).getUTCDay() === 3) amount *= 3;
      }
      this.state.balance -= amount;
      p.funding += amount;
      any = true;
      this._event('funding', `${market === 'crypto' ? 'Funding' : 'Swap'} on ${sym.id}: ${amount > 0 ? '-' : '+'}$${Math.abs(amount).toFixed(2)}`);
    }
    return any;
  }

  // ---------- journal ----------
  setJournal(tradeId, data) {
    this.state.journal[tradeId] = { ...(this.state.journal[tradeId] || {}), ...data };
    this._emit();
  }

  addNote(text) {
    if (!text.trim()) return;
    this.state.notes.unshift({ id: this._id(), ts: this.now(), text: text.trim() });
    this._emit();
  }

  deleteNote(id) {
    this.state.notes = this.state.notes.filter((n) => n.id !== id);
    this._emit();
  }

  stats() {
    const h = this.state.history;
    const wins = h.filter((t) => t.pnl > 0);
    const losses = h.filter((t) => t.pnl <= 0);
    const gp = wins.reduce((a, t) => a + t.pnl, 0);
    const gl = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
    return {
      trades: h.length,
      winRate: h.length ? wins.length / h.length : 0,
      profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
      avgWin: wins.length ? gp / wins.length : 0,
      avgLoss: losses.length ? -gl / losses.length : 0,
      net: h.reduce((a, t) => a + t.pnl, 0),
      fees: h.reduce((a, t) => a + t.fees + t.funding, 0),
    };
  }
}

/** Pre-trade numbers shown in the order ticket. */
export function estimateOrder(sym, quote, { side, qty, leverage, price, sl, tp, type = 'market' }, metrics) {
  const ref = type === 'market' || !price ? (side === 'buy' ? quote.ask : quote.bid) : price;
  const notional = notionalUsd(sym, qty, ref);
  const margin = notional / Math.max(1, leverage);
  const fee = notional * (type === 'limit' ? sym.makerFee : sym.takerFee);
  const dir = side === 'buy' ? 1 : -1;
  const risk = sl ? Math.abs(pnlUsd(sym, qty, ref, sl, dir)) : null;
  const reward = tp ? Math.abs(pnlUsd(sym, qty, ref, tp, dir)) : null;
  let liq = null;
  if (metrics) {
    const allowed = metrics.equity - fee - STOP_OUT_LEVEL * (metrics.used + margin);
    const unit = qty * quoteToUsd(sym, ref);
    if (unit > 0) {
      const move = allowed / unit;
      const px = side === 'buy' ? ref - move : ref + move;
      liq = px > 0 ? px : null;
    }
  }
  return { ref, notional, margin, fee, risk, reward, rr: risk && reward ? reward / risk : null, liq };
}
