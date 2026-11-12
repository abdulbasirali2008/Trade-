// App singletons: market feed, broker, UI/settings stores, toasts, sound and React hooks.

import { useSyncExternalStore } from 'react';
import { MarketFeed } from './lib/feed.js';
import { Broker } from './lib/broker.js';
import { createStore } from './store.js';

export const feed = new MarketFeed();

function safeStorage() {
  try {
    const s = window.localStorage;
    s.setItem('__probe', '1');
    s.removeItem('__probe');
    return s;
  } catch (e) {
    return null;
  }
}

export const broker = new Broker({
  getQuote: (id) => feed.quotes[id],
  getBook: (id) => feed.books[id],
  storage: safeStorage(),
});

feed.onQuote((id) => broker.onQuote(id));
window.addEventListener('beforeunload', () => broker.flush());

// ---------- settings & UI state ----------
export const settings = createStore(
  { tdKey: '', sound: true, defaultBalance: 10000 },
  'trade-academy-settings',
);

export const ui = createStore(
  {
    view: 'trade',
    symbol: 'BTCUSDT',
    tf: '5m',
    indicators: { sma20: true, sma50: false, ema20: false, bb: false, vol: true, rsi: false, macd: false },
    tool: 'cursor', // 'cursor' | 'hline'
    lines: {}, // horizontal lines drawn on the chart, per symbol
    watch: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'],
    lessonsDone: {},
    quiz: {},
  },
  'trade-academy-ui',
);

// Price picked by clicking on the chart, consumed by the order ticket.
export const draft = createStore({ price: null, stamp: 0 });

// ---------- toasts ----------
export const toasts = createStore({ items: [] });
let toastId = 1;
export function toast(type, msg) {
  const id = toastId++;
  toasts.set((s) => ({ items: [...s.items.slice(-3), { id, type, msg }] }));
  setTimeout(() => toasts.set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 5000);
}

let audio = null;
function beep(freq, ms, gain = 0.04) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch (e) { /* audio blocked */ }
}

broker.onEvent((ev) => {
  const kind = { fill: 'ok', tp: 'ok', sl: 'bad', stopout: 'bad', reject: 'bad', warn: 'warn', info: 'info', funding: 'info' }[ev.type] || 'info';
  if (ev.type !== 'funding') toast(kind, ev.msg);
  if (!settings.get().sound) return;
  if (ev.type === 'fill') beep(660, 90);
  else if (ev.type === 'tp') { beep(660, 90); setTimeout(() => beep(880, 140), 100); }
  else if (ev.type === 'sl' || ev.type === 'stopout') beep(220, 220, 0.06);
  else if (ev.type === 'reject' || ev.type === 'warn') beep(300, 120, 0.05);
});

// ---------- hooks ----------
export function useFeed() {
  useSyncExternalStore(feed.subscribeUi, feed.getUiVersion);
  return feed;
}

export function useBroker() {
  useSyncExternalStore(broker.subscribe, broker.getVersion);
  return broker;
}

export function startApp() {
  feed.start({ tdKey: settings.get().tdKey });
  const s = ui.get();
  feed.setActive(s.symbol, s.tf);
  settings.subscribe(() => {
    const key = settings.get().tdKey;
    if (key !== feed.tdKey) feed.setTdKey(key);
  });
}
