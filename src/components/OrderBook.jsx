import { useEffect, useState } from 'react';
import { feed, ui, useFeed } from '../core.js';
import { useStore } from '../store.js';
import { getSym, fmtPrice, pipValueUsd } from '../lib/symbols.js';

const fmtSize = (sym, v) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(sym.qtyStep < 1 ? 3 : 0));

function Depth({ sym, book, q }) {
  const asks = book.asks.slice(0, 8);
  const bids = book.bids.slice(0, 8);
  const cum = (rows) => { let c = 0; return rows.map(([p, s]) => { c += s; return [p, s, c]; }); };
  const a = cum(asks);
  const b = cum(bids);
  const max = Math.max(a[a.length - 1]?.[2] || 1, b[b.length - 1]?.[2] || 1);
  return (
    <>
      <div className="hd"><span>Price</span><span style={{ textAlign: 'right' }}>Size</span><span style={{ textAlign: 'right' }}>Total</span></div>
      {[...a].reverse().map(([p, s, c]) => (
        <div className="r ask" key={`a${p}`}><span>{fmtPrice(sym, p)}</span><span>{fmtSize(sym, s)}</span><span>{fmtSize(sym, c)}</span><i style={{ width: `${(c / max) * 100}%` }} /></div>
      ))}
      <div className="mid">{fmtPrice(sym, q.last)}</div>
      {b.map(([p, s, c]) => (
        <div className="r bid" key={`b${p}`}><span>{fmtPrice(sym, p)}</span><span>{fmtSize(sym, s)}</span><span>{fmtSize(sym, c)}</span><i style={{ width: `${(c / max) * 100}%` }} /></div>
      ))}
    </>
  );
}

function MarketInfo({ sym, q }) {
  const pipUsd = pipValueUsd(sym, q.last);
  return (
    <dl className="info">
      <dt>Spread</dt><dd>{((q.ask - q.bid) / sym.pip).toFixed(1)} pips</dd>
      <dt>1 lot</dt><dd>{sym.lotSize.toLocaleString('en-US')} {sym.id === 'XAUUSD' ? 'oz' : 'units'}</dd>
      <dt>Pip value / lot</dt><dd>${pipUsd.toFixed(2)}</dd>
      <dt>Max leverage</dt><dd>{sym.maxLev}x</dd>
      <dt>Swap long / short</dt><dd>{(sym.swapLong * 100).toFixed(4)}% / {(sym.swapShort * 100).toFixed(4)}%</dd>
      <dt>Swap charged</dt><dd>22:00 UTC (3x Wed)</dd>
    </dl>
  );
}

export default function OrderBook() {
  const f = useFeed();
  const { symbol } = useStore(ui);
  const sym = getSym(symbol);
  const q = f.quotes[symbol];
  const [book, setBook] = useState(null);

  useEffect(() => {
    setBook(feed.books[symbol] ? { ...feed.books[symbol] } : null);
    let t = null;
    const off = feed.onBook((id, bk) => {
      if (id !== symbol || t) return;
      t = setTimeout(() => { t = null; setBook({ ...bk }); }, 200);
    });
    return () => { off(); clearTimeout(t); };
  }, [symbol]);

  const isCrypto = sym.market === 'crypto';
  return (
    <div className="book">
      <h3>
        <span>{isCrypto ? 'Order book' : 'Market info'}</span>
        {isCrypto && <span className="mono muted">{q.src === 'live' ? 'live' : 'sim'}</span>}
      </h3>
      {isCrypto && book && <Depth sym={sym} book={book} q={q} />}
      {isCrypto && !book && <p className="hint">Waiting for the order book…</p>}
      {!isCrypto && <MarketInfo sym={sym} q={q} />}
    </div>
  );
}
