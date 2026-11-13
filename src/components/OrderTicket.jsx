import { useEffect, useState } from 'react';
import { feed, broker, ui, draft, useFeed, useBroker } from '../core.js';
import { useStore } from '../store.js';
import { getSym, fmtPrice, fmtUsd, roundQty, baseToUsd, quoteToUsd } from '../lib/symbols.js';
import { estimateOrder } from '../lib/broker.js';

const TYPES = [['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop']];
const LEV_CHIPS = [1, 2, 5, 10, 20, 50, 100, 200];

export default function OrderTicket() {
  const f = useFeed();
  useBroker();
  const { symbol } = useStore(ui);
  const d = useStore(draft);
  const sym = getSym(symbol);
  const q = f.quotes[symbol];

  const [type, setType] = useState('market');
  const [size, setSize] = useState('');
  const [lev, setLev] = useState(10);
  const [price, setPrice] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [busy, setBusy] = useState(false);

  // Fresh defaults for each instrument.
  useEffect(() => {
    const last = feed.quotes[symbol].last;
    setSize(sym.market === 'forex' ? '0.10' : String(roundQty(sym, 1000 / last)));
    setLev(Math.min(sym.market === 'forex' ? 30 : 10, sym.maxLev));
    setSl('');
    setTp('');
    setPrice('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // A price clicked on the chart fills the entry price of limit and stop orders.
  useEffect(() => {
    if (d.price && type !== 'market') setPrice(String(d.price));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.stamp]);

  const isFx = sym.market === 'forex';
  const sizeNum = parseFloat(size);
  const qty = Number.isFinite(sizeNum) && sizeNum > 0 ? roundQty(sym, isFx ? sizeNum * sym.lotSize : sizeNum) : 0;
  const priceNum = parseFloat(price) || 0;
  const slNum = parseFloat(sl) || 0;
  const tpNum = parseFloat(tp) || 0;
  const m = broker.metrics();

  const base = { qty, leverage: lev, price: priceNum || undefined, type };
  const estBuy = estimateOrder(sym, q, { ...base, side: 'buy' }, m);
  const estSell = estimateOrder(sym, q, { ...base, side: 'sell' }, m);
  const ref = type === 'market' || !priceNum ? q.last : priceNum;
  const unitUsd = qty * quoteToUsd(sym, ref);
  const risk = slNum ? unitUsd * Math.abs(ref - slNum) : null;
  const reward = tpNum ? unitUsd * Math.abs(tpNum - ref) : null;

  const fillSize = (pct) => {
    const refPx = q.ask;
    const notional = Math.max(0, m.free) * pct * lev * 0.97;
    const units = notional / baseToUsd(sym, refPx);
    const rounded = roundQty(sym, units);
    setSize(isFx ? (rounded / sym.lotSize).toFixed(2) : String(rounded));
  };

  const submit = async (side) => {
    const req = { symbol, side, qty, leverage: lev, price: priceNum || undefined, sl: slNum || undefined, tp: tpNum || undefined, type };
    if (type === 'market') {
      setBusy(true);
      try { await broker.placeMarket(req); } finally { setBusy(false); }
    } else {
      const r = broker.placeOrder(req);
      if (r.ok && !r.immediate) setPrice('');
    }
  };

  const stepSize = isFx ? '0.01' : String(sym.qtyStep);
  const disabled = busy || qty <= 0;

  return (
    <div className="ticket">
      <h3>
        <span>Order ticket</span>
        <span className="mono muted">{sym.base}/{sym.quote}</span>
      </h3>

      <div className="seg" role="group" aria-label="Order type">
        {TYPES.map(([id, label]) => (
          <button key={id} className={type === id ? 'on' : ''} onClick={() => setType(id)}>{label}</button>
        ))}
      </div>

      {type !== 'market' && (
        <div className="field">
          <label htmlFor="ot-price">{type === 'limit' ? 'Limit price' : 'Stop trigger price'}</label>
          <input id="ot-price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={fmtPrice(sym, q.last)} />
        </div>
      )}

      <div className="field">
        <label htmlFor="ot-size">
          <span>{isFx ? 'Size (lots)' : `Size (${sym.base})`}</span>
          <span className="mono">{isFx ? `${qty.toLocaleString('en-US')} units` : `≈ ${fmtUsd(qty * q.last, 0)}`}</span>
        </label>
        <input id="ot-size" className="input" type="number" min="0" step={stepSize} value={size} onChange={(e) => setSize(e.target.value)} />
        <div className="quick" aria-label="Size from free margin">
          {[0.1, 0.25, 0.5, 1].map((p) => (
            <button key={p} onClick={() => fillSize(p)}>{p * 100}%</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="ot-lev"><span>Leverage</span><span className="mono">{lev}x</span></label>
        <input id="ot-lev" type="range" min="1" max={sym.maxLev} step="1" value={lev} onChange={(e) => setLev(+e.target.value)} />
        <div className="quick">
          {LEV_CHIPS.filter((x) => x <= sym.maxLev).map((x) => (
            <button key={x} onClick={() => setLev(x)}>{x}x</button>
          ))}
        </div>
      </div>

      <div className="row2">
        <div className="field">
          <label htmlFor="ot-sl">Stop-loss</label>
          <div className="inwrap">
            <input id="ot-sl" className="input" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="optional" />
            <button type="button" title="Use the price you clicked on the chart" onClick={() => d.price && setSl(String(d.price))}>chart</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="ot-tp">Take-profit</label>
          <div className="inwrap">
            <input id="ot-tp" className="input" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="optional" />
            <button type="button" title="Use the price you clicked on the chart" onClick={() => d.price && setTp(String(d.price))}>chart</button>
          </div>
        </div>
      </div>

      <dl className="est">
        <dt>Position value</dt><dd>{fmtUsd(estBuy.notional)}</dd>
        <dt>Margin required</dt><dd className={estBuy.margin > m.free ? 'down' : ''}>{fmtUsd(estBuy.margin)}</dd>
        <dt>Est. fee</dt><dd>{fmtUsd(estBuy.fee)}</dd>
        <dt>Liq. long / short</dt><dd>{estBuy.liq ? fmtPrice(sym, estBuy.liq) : '–'} / {estSell.liq ? fmtPrice(sym, estSell.liq) : '–'}</dd>
        {risk != null && (<><dt>Risk to SL</dt><dd className="down">{fmtUsd(risk)}</dd></>)}
        {reward != null && (<><dt>Reward to TP</dt><dd className="up">{fmtUsd(reward)}</dd></>)}
        {risk != null && reward != null && risk > 0 && (<><dt>Reward : risk</dt><dd>{(reward / risk).toFixed(2)} : 1</dd></>)}
      </dl>

      <div className="go">
        <button className="sell" disabled={disabled} onClick={() => submit('sell')}>
          {type === 'market' ? 'Sell / Short' : `Sell ${type}`}
          <small>{fmtPrice(sym, q.bid)}</small>
        </button>
        <button className="buy" disabled={disabled} onClick={() => submit('buy')}>
          {type === 'market' ? 'Buy / Long' : `Buy ${type}`}
          <small>{fmtPrice(sym, q.ask)}</small>
        </button>
      </div>
      <p className="hint">
        Buys fill at the ask, sells at the bid. {type === 'market' ? 'Market orders take a fraction of a second and can slip.' : 'Pending orders fill when the price reaches them, even if you are away.'}
        {' '}An opposite order reduces or closes your position on this instrument.
      </p>
    </div>
  );
}
