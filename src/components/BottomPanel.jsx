import { useState } from 'react';
import { broker, ui, useFeed, useBroker } from '../core.js';
import { getSym, fmtPrice, fmtQty, fmtUsd } from '../lib/symbols.js';

const REASON = { manual: 'Closed', sl: 'Stop-loss', tp: 'Take-profit', stopout: 'Stop-out' };
const dt = (ts) => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const clock = (ts) => new Date(ts).toLocaleTimeString('en-GB');
const pl = (v) => <span className={v > 0 ? 'up' : v < 0 ? 'down' : ''}>{v > 0 ? '+' : ''}{fmtUsd(v)}</span>;

function StopEditor({ p, onDone }) {
  const sym = getSym(p.symbol);
  const [sl, setSl] = useState(p.sl ? String(p.sl) : '');
  const [tp, setTp] = useState(p.tp ? String(p.tp) : '');
  const [err, setErr] = useState('');
  const save = () => {
    const r = broker.setStops(p.id, { sl: parseFloat(sl) || null, tp: parseFloat(tp) || null });
    if (r.ok) onDone(); else setErr(r.error);
  };
  return (
    <div className="stopedit">
      <input className="input" aria-label="Stop-loss" placeholder="SL" value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" />
      <input className="input" aria-label="Take-profit" placeholder="TP" value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" />
      <button className="btn small primary" onClick={save}>Save</button>
      <button className="btn small" onClick={onDone}>Cancel</button>
      {err && <span className="down" style={{ fontSize: 11 }}>{err}</span>}
      <span className="muted" style={{ fontSize: 10 }}>{sym.id}</span>
    </div>
  );
}

function Positions() {
  const f = useFeed();
  const b = useBroker();
  const [editing, setEditing] = useState(null);
  const rows = b.state.positions;
  if (!rows.length) return <div className="empty">No open positions. Place an order from the ticket.</div>;
  return (
    <table>
      <thead>
        <tr><th>Symbol</th><th>Side</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Price</th><th className="r">P/L</th><th className="r">ROE</th><th className="r">Margin</th><th className="r">Liq.</th><th>SL / TP</th><th /></tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const sym = getSym(p.symbol);
          const q = f.quotes[p.symbol];
          const exit = p.side === 'long' ? q.bid : q.ask;
          const u = b.upl(p);
          const liq = b.liqPrice(p);
          return (
            <tr key={p.id}>
              <td className="t"><a href="#chart" onClick={(e) => { e.preventDefault(); ui.set({ symbol: p.symbol }); }}>{sym.base}/{sym.quote}</a> <span className="muted">{p.leverage}x</span></td>
              <td><span className={`side-tag ${p.side}`}>{p.side.toUpperCase()}</span></td>
              <td className="r">{fmtQty(sym, p.qty)}</td>
              <td className="r">{fmtPrice(sym, p.entry)}</td>
              <td className="r">{fmtPrice(sym, exit)}</td>
              <td className="r">{pl(u)}</td>
              <td className="r"><span className={u >= 0 ? 'up' : 'down'}>{((u / p.margin) * 100).toFixed(1)}%</span></td>
              <td className="r">{fmtUsd(p.margin)}</td>
              <td className="r">{liq ? fmtPrice(sym, liq) : '–'}</td>
              <td>
                {editing === p.id ? (
                  <StopEditor p={p} onDone={() => setEditing(null)} />
                ) : (
                  <button className="btn small" onClick={() => setEditing(p.id)} title="Edit stop-loss and take-profit">
                    {p.sl ? fmtPrice(sym, p.sl) : '–'} / {p.tp ? fmtPrice(sym, p.tp) : '–'}
                  </button>
                )}
              </td>
              <td>
                <div className="act">
                  <button className="btn small" onClick={() => broker.closePosition(p.id, 0.5)}>50%</button>
                  <button className="btn small danger" onClick={() => broker.closePosition(p.id, 1)}>Close</button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Orders() {
  const b = useBroker();
  const rows = b.state.orders;
  if (!rows.length) return <div className="empty">No pending orders. Choose Limit or Stop in the ticket.</div>;
  return (
    <table>
      <thead><tr><th>Symbol</th><th>Type</th><th>Side</th><th className="r">Size</th><th className="r">Price</th><th className="r">Lev.</th><th>Placed</th><th /></tr></thead>
      <tbody>
        {rows.map((o) => {
          const sym = getSym(o.symbol);
          return (
            <tr key={o.id}>
              <td className="t">{sym.base}/{sym.quote}</td>
              <td className="t">{o.type}</td>
              <td className={o.side === 'buy' ? 'up' : 'down'}>{o.side.toUpperCase()}</td>
              <td className="r">{fmtQty(sym, o.qty)}</td>
              <td className="r">{fmtPrice(sym, o.price)}</td>
              <td className="r">{o.leverage}x</td>
              <td>{dt(o.createdAt)}</td>
              <td><button className="btn small danger" onClick={() => broker.cancelOrder(o.id)}>Cancel</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function History() {
  const b = useBroker();
  const rows = b.state.history.slice(0, 100);
  if (!rows.length) return <div className="empty">Closed trades will appear here.</div>;
  return (
    <table>
      <thead><tr><th>Closed</th><th>Symbol</th><th>Side</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">Costs</th><th className="r">Net P/L</th><th>How</th></tr></thead>
      <tbody>
        {rows.map((t) => {
          const sym = getSym(t.symbol);
          return (
            <tr key={t.id}>
              <td>{dt(t.closedAt)}</td>
              <td className="t">{sym.base}/{sym.quote}</td>
              <td><span className={`side-tag ${t.side}`}>{t.side.toUpperCase()}</span></td>
              <td className="r">{fmtQty(sym, t.qty)}</td>
              <td className="r">{fmtPrice(sym, t.entry)}</td>
              <td className="r">{fmtPrice(sym, t.exit)}</td>
              <td className="r">{fmtUsd(t.fees + t.funding)}</td>
              <td className="r">{pl(t.pnl)}</td>
              <td className="t">{REASON[t.reason] || t.reason}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Log() {
  const b = useBroker();
  const rows = b.state.log;
  if (!rows.length) return <div className="empty">Fills, rejections and account events show up here.</div>;
  return (
    <div>
      {rows.map((e) => (
        <div className="logline" key={e.id}>
          <time>{clock(e.ts)}</time>
          <span className={e.type === 'reject' || e.type === 'sl' || e.type === 'stopout' ? 'down' : e.type === 'tp' ? 'up' : e.type === 'warn' ? 'warn' : ''}>{e.msg}</span>
        </div>
      ))}
    </div>
  );
}

export default function BottomPanel() {
  const b = useBroker();
  const [tab, setTab] = useState('positions');
  const s = b.stats();
  const tabs = [
    ['positions', 'Positions', b.state.positions.length],
    ['orders', 'Orders', b.state.orders.length],
    ['history', 'History', b.state.history.length],
    ['log', 'Activity', 0],
  ];
  return (
    <div className="bottom">
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}{n > 0 && <span className="cnt">{n}</span>}
          </button>
        ))}
        <span className="sp" />
        <span className="end">
          {s.trades > 0 ? `${s.trades} trades · win ${(s.winRate * 100).toFixed(0)}% · net ${s.net >= 0 ? '+' : ''}${fmtUsd(s.net)}` : ''}
        </span>
      </div>
      <div className="scroll">
        {tab === 'positions' && <Positions />}
        {tab === 'orders' && <Orders />}
        {tab === 'history' && <History />}
        {tab === 'log' && <Log />}
      </div>
    </div>
  );
}
