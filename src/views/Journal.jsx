import { useState } from 'react';
import { broker } from '../core.js';
import { useBroker } from '../core.js';
import Curve from '../components/Curve.jsx';
import { getSym, fmtPrice, fmtQty, fmtUsd } from '../lib/symbols.js';

const SETUPS = ['Trend following', 'Breakout', 'Reversal', 'Support / resistance', 'News', 'No clear setup'];
const FEELINGS = ['Calm', 'Confident', 'Anxious', 'FOMO', 'Revenge', 'Bored'];
const dt = (ts) => new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function Stars({ value = 0, onChange }) {
  return (
    <span className="stars" role="group" aria-label="Execution rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? 'on' : ''} onClick={() => onChange(n === value ? 0 : n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>★</button>
      ))}
    </span>
  );
}

function TradeRow({ t }) {
  const [open, setOpen] = useState(false);
  const j = broker.state.journal[t.id] || {};
  const sym = getSym(t.symbol);
  const set = (patch) => broker.setJournal(t.id, patch);
  return (
    <>
      <tr>
        <td>{dt(t.closedAt)}</td>
        <td className="t">{sym.base}/{sym.quote}</td>
        <td><span className={`side-tag ${t.side}`}>{t.side.toUpperCase()}</span></td>
        <td className="r">{fmtQty(sym, t.qty)}</td>
        <td className="r">{fmtPrice(sym, t.entry)} → {fmtPrice(sym, t.exit)}</td>
        <td className={`r ${t.pnl >= 0 ? 'up' : 'down'}`}>{t.pnl >= 0 ? '+' : ''}{fmtUsd(t.pnl)}</td>
        <td className="t">{j.setup || <span className="muted">–</span>}</td>
        <td><button className="btn small" onClick={() => setOpen(!open)}>{open ? 'Close' : j.note ? 'Edit note' : 'Add note'}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="t" style={{ background: 'var(--panel2)', whiteSpace: 'normal' }}>
            <div className="row2" style={{ maxWidth: 720 }}>
              <div className="field">
                <label htmlFor={`js-${t.id}`}>Setup</label>
                <select id={`js-${t.id}`} className="input" value={j.setup || ''} onChange={(e) => set({ setup: e.target.value })}>
                  <option value="">Choose…</option>
                  {SETUPS.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`jf-${t.id}`}>How did you feel?</label>
                <select id={`jf-${t.id}`} className="input" value={j.feeling || ''} onChange={(e) => set({ feeling: e.target.value })}>
                  <option value="">Choose…</option>
                  {FEELINGS.map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
            </div>
            <div className="field" style={{ maxWidth: 720, marginTop: 8 }}>
              <label htmlFor={`jn-${t.id}`}>What was the plan, and did you follow it?</label>
              <textarea id={`jn-${t.id}`} className="input" value={j.note || ''} onChange={(e) => set({ note: e.target.value })} />
            </div>
            <div className="inline" style={{ marginTop: 8 }}>
              <span className="muted">Rule-following:</span>
              <Stars value={j.rating || 0} onChange={(n) => set({ rating: n })} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Journal() {
  const b = useBroker();
  const [note, setNote] = useState('');
  const s = b.stats();
  const h = b.state.history;
  const chrono = [...h].reverse();
  let run = b.state.startBalance;
  const curve = [run, ...chrono.map((t) => (run += t.pnl))];

  const bySym = {};
  for (const t of h) {
    const r = (bySym[t.symbol] = bySym[t.symbol] || { n: 0, wins: 0, pnl: 0 });
    r.n++; r.pnl += t.pnl; if (t.pnl > 0) r.wins++;
  }
  const bySetup = {};
  for (const t of h) {
    const k = b.state.journal[t.id]?.setup;
    if (!k) continue;
    const r = (bySetup[k] = bySetup[k] || { n: 0, wins: 0, pnl: 0 });
    r.n++; r.pnl += t.pnl; if (t.pnl > 0) r.wins++;
  }
  const rated = h.filter((t) => b.state.journal[t.id]?.rating);
  const avgRated = (min, max) => {
    const rows = rated.filter((t) => { const r = b.state.journal[t.id].rating; return r >= min && r <= max; });
    return rows.length ? rows.reduce((a, t) => a + t.pnl, 0) / rows.length : null;
  };
  const disciplined = avgRated(4, 5);
  const sloppy = avgRated(1, 2);

  return (
    <div className="page">
      <div className="page-in">
        <div>
          <h1>Trading journal</h1>
          <p className="lead">Your results, plus space to write down why you took each trade. Reviewing both is how traders improve.</p>
        </div>

        <div className="card">
          <h2>Performance</h2>
          <div className="stats">
            <div className="stat"><span>Net P/L</span><span className={s.net >= 0 ? 'up' : 'down'}>{fmtUsd(s.net)}</span></div>
            <div className="stat"><span>Trades</span><span>{s.trades}</span></div>
            <div className="stat"><span>Win rate</span><span>{(s.winRate * 100).toFixed(0)}%</span></div>
            <div className="stat"><span>Profit factor</span><span>{Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</span></div>
            <div className="stat"><span>Avg win</span><span className="up">{fmtUsd(s.avgWin, 0)}</span></div>
            <div className="stat"><span>Avg loss</span><span className="down">{fmtUsd(s.avgLoss, 0)}</span></div>
            <div className="stat"><span>Fees and funding</span><span>{fmtUsd(s.fees, 0)}</span></div>
          </div>
          {h.length > 1 ? <Curve values={curve} base={b.state.startBalance} fmt={(v) => fmtUsd(v, 0)} label="Balance after each closed trade" /> : <div className="empty">Close a few trades to see your balance curve.</div>}
          {disciplined != null && sloppy != null && (
            <div className="notice info">Average result when you rated rule-following 4–5 stars: {fmtUsd(disciplined)}. At 1–2 stars: {fmtUsd(sloppy)}.</div>
          )}
        </div>

        {(Object.keys(bySym).length > 0 || Object.keys(bySetup).length > 0) && (
          <div className="grid2">
            {Object.keys(bySym).length > 0 && (
              <div className="card">
                <h2>By instrument</h2>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Symbol</th><th className="r">Trades</th><th className="r">Win rate</th><th className="r">P/L</th></tr></thead>
                    <tbody>
                      {Object.entries(bySym).map(([id, r]) => (
                        <tr key={id}><td className="t">{getSym(id).base}/{getSym(id).quote}</td><td className="r">{r.n}</td><td className="r">{((r.wins / r.n) * 100).toFixed(0)}%</td><td className={`r ${r.pnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(r.pnl)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {Object.keys(bySetup).length > 0 && (
              <div className="card">
                <h2>By setup</h2>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Setup</th><th className="r">Trades</th><th className="r">Win rate</th><th className="r">P/L</th></tr></thead>
                    <tbody>
                      {Object.entries(bySetup).map(([k, r]) => (
                        <tr key={k}><td className="t">{k}</td><td className="r">{r.n}</td><td className="r">{((r.wins / r.n) * 100).toFixed(0)}%</td><td className={`r ${r.pnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(r.pnl)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="card">
          <h2>Closed trades</h2>
          {h.length === 0 ? <div className="empty">No closed trades yet. Trade on the demo account, then come back to review.</div> : (
            <div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}>
              <table>
                <thead><tr><th>Closed</th><th>Symbol</th><th>Side</th><th className="r">Size</th><th className="r">Entry → exit</th><th className="r">Net P/L</th><th>Setup</th><th /></tr></thead>
                <tbody>{h.slice(0, 100).map((t) => <TradeRow key={t.id} t={t} />)}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Notes</h2>
          <div className="field">
            <label htmlFor="jn-new">Lessons, rules and ideas</label>
            <textarea id="jn-new" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Example: I will not trade the 5 minute chart after two losses in a row." />
          </div>
          <div><button className="btn primary" disabled={!note.trim()} onClick={() => { broker.addNote(note); setNote(''); }}>Save note</button></div>
          {b.state.notes.length === 0 ? <div className="empty">No notes yet.</div> : (
            <div>
              {b.state.notes.map((n) => (
                <div className="logline" key={n.id}>
                  <time>{dt(n.ts)}</time>
                  <span style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{n.text}</span>
                  <button className="btn small" onClick={() => broker.deleteNote(n.id)}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
