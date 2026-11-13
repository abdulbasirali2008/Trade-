import { useState } from 'react';
import { feed, broker } from '../core.js';
import { SYMBOLS, getSym, fmtPrice, fmtQty, fmtUsd, roundQty, notionalUsd, quoteToUsd, pipValueUsd } from '../lib/symbols.js';

export default function Risk() {
  const [symId, setSymId] = useState('EURUSD');
  const sym = getSym(symId);
  const live = feed.quotes[symId].last;
  const [balance, setBalance] = useState(String(Math.round(broker.metrics().equity)));
  const [riskPct, setRiskPct] = useState('1');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [lev, setLev] = useState('10');

  const e = parseFloat(entry) || live;
  const st = parseFloat(stop);
  const tg = parseFloat(target);
  const bal = parseFloat(balance) || 0;
  const rp = parseFloat(riskPct) || 0;
  const lv = Math.max(1, parseFloat(lev) || 1);

  const riskAmt = (bal * rp) / 100;
  const dist = Number.isFinite(st) ? Math.abs(e - st) : 0;
  const valid = dist > 0;
  const rawQty = valid ? riskAmt / (dist * quoteToUsd(sym, e)) : 0;
  const qty = valid ? roundQty(sym, rawQty) : 0;
  const realRisk = qty * dist * quoteToUsd(sym, e);
  const notional = notionalUsd(sym, qty, e);
  const margin = notional / lv;
  const reward = Number.isFinite(tg) ? qty * Math.abs(tg - e) * quoteToUsd(sym, e) : null;
  const rr = reward != null && realRisk > 0 ? reward / realRisk : null;
  const pips = sym.market === 'forex' && valid ? dist / sym.pip : null;
  const direction = Number.isFinite(st) ? (st < e ? 'Long' : 'Short') : null;
  const liqDist = e / lv; // distance at which margin is gone, ignoring fees
  const stopBeyondLiq = valid && dist >= liqDist * 0.95;

  const streak = [3, 5, 10, 15].map((n) => ({ n, left: bal * Math.pow(1 - rp / 100, n) }));
  const lots = sym.market === 'forex' ? qty / sym.lotSize : null;

  return (
    <div className="page">
      <div className="page-in">
        <div>
          <h1>Risk calculator</h1>
          <p className="lead">Decide where you are wrong first (the stop), then let the calculator tell you how big the position can be.</p>
        </div>
        <div className="cols">
          <div className="card">
            <h2>Trade plan</h2>
            <div className="field">
              <label htmlFor="rk-sym">Instrument</label>
              <select id="rk-sym" className="input" value={symId} onChange={(ev) => { setSymId(ev.target.value); setEntry(''); setStop(''); setTarget(''); }}>
                {SYMBOLS.map((x) => <option key={x.id} value={x.id}>{x.base}/{x.quote}</option>)}
              </select>
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="rk-bal">Account balance (USD)</label>
                <input id="rk-bal" className="input" inputMode="decimal" value={balance} onChange={(ev) => setBalance(ev.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="rk-risk">Risk per trade (%)</label>
                <input id="rk-risk" className="input" inputMode="decimal" value={riskPct} onChange={(ev) => setRiskPct(ev.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="rk-entry"><span>Entry price</span><span className="mono">live {fmtPrice(sym, live)}</span></label>
              <input id="rk-entry" className="input" inputMode="decimal" value={entry} placeholder={fmtPrice(sym, live)} onChange={(ev) => setEntry(ev.target.value)} />
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="rk-stop">Stop-loss price</label>
                <input id="rk-stop" className="input" inputMode="decimal" value={stop} onChange={(ev) => setStop(ev.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="rk-tp">Take-profit price</label>
                <input id="rk-tp" className="input" inputMode="decimal" value={target} onChange={(ev) => setTarget(ev.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="rk-lev">Leverage</label>
              <input id="rk-lev" className="input" inputMode="decimal" value={lev} onChange={(ev) => setLev(ev.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="card">
              <h2>Result</h2>
              {!valid && <div className="notice info">Enter a stop-loss price to see the position size.</div>}
              {valid && (
                <>
                  <div className="stats">
                    <div className="stat"><span>Direction</span><span>{direction}</span></div>
                    <div className="stat"><span>Position size</span><span>{fmtQty(sym, qty)}</span></div>
                    <div className="stat"><span>Risk if stopped</span><span className="down">{fmtUsd(realRisk)}</span></div>
                    <div className="stat"><span>Margin needed</span><span>{fmtUsd(margin)}</span></div>
                    <div className="stat"><span>Position value</span><span>{fmtUsd(notional, 0)}</span></div>
                    {pips != null && <div className="stat"><span>Stop distance</span><span>{pips.toFixed(1)} pips</span></div>}
                    {lots != null && <div className="stat"><span>Pip value</span><span>${(pipValueUsd(sym, e) * lots).toFixed(2)}</span></div>}
                    {reward != null && <div className="stat"><span>Reward at target</span><span className="up">{fmtUsd(reward)}</span></div>}
                    {rr != null && <div className="stat"><span>Reward : risk</span><span>{rr.toFixed(2)} : 1</span></div>}
                    {rr != null && <div className="stat"><span>Break-even win rate</span><span>{(100 / (1 + rr)).toFixed(0)}%</span></div>}
                  </div>
                  {qty < sym.minQty && <div className="notice">The risk amount is too small for this instrument's minimum size. Raise the risk percentage or use a tighter stop.</div>}
                  {stopBeyondLiq && <div className="notice">At {lv}x leverage your position is liquidated about {(100 / lv).toFixed(1)}% from entry, which is at or before your stop. Lower the leverage so the stop is hit first.</div>}
                  {margin > bal && <div className="notice">The margin needed is larger than the balance. Lower the risk or the size, or raise the leverage.</div>}
                  {direction && Number.isFinite(tg) && ((direction === 'Long' && tg < e) || (direction === 'Short' && tg > e)) && (
                    <div className="notice">The take-profit is on the wrong side of the entry for a {direction.toLowerCase()} trade.</div>
                  )}
                </>
              )}
            </div>

            <div className="card">
              <h2>What a losing streak does</h2>
              <p className="muted" style={{ margin: 0 }}>Balance left after consecutive full losses at {rp || 0}% risk per trade.</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Losses in a row</th><th className="r">Balance left</th><th className="r">Drawdown</th><th className="r">Gain needed to recover</th></tr></thead>
                  <tbody>
                    {streak.map(({ n, left }) => {
                      const dd = bal > 0 ? (1 - left / bal) * 100 : 0;
                      return (
                        <tr key={n}>
                          <td className="t">{n}</td>
                          <td className="r">{fmtUsd(left)}</td>
                          <td className="r down">-{dd.toFixed(1)}%</td>
                          <td className="r">{dd < 100 ? `+${((bal / left - 1) * 100).toFixed(1)}%` : '–'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
