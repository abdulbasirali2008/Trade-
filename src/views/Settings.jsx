import { useState } from 'react';
import { broker, settings, feed, useFeed } from '../core.js';
import { useStore } from '../store.js';
import { getSym, fmtUsd } from '../lib/symbols.js';

const BALANCES = [1000, 5000, 10000, 50000, 100000];

function exportCsv() {
  const rows = [['closed_at', 'symbol', 'side', 'size', 'entry', 'exit', 'gross_pnl', 'fees', 'funding', 'net_pnl', 'leverage', 'reason']];
  for (const t of [...broker.state.history].reverse()) {
    rows.push([new Date(t.closedAt).toISOString(), t.symbol, t.side, t.qty, t.entry, t.exit, t.gross.toFixed(2), t.fees.toFixed(2), t.funding.toFixed(2), t.pnl.toFixed(2), t.leverage, t.reason]);
  }
  const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trade-academy-history.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function Settings() {
  const f = useFeed();
  const s = useStore(settings);
  const [key, setKey] = useState(s.tdKey);
  const [bal, setBal] = useState(String(s.defaultBalance));
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveKey = () => {
    settings.set({ tdKey: key.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const doReset = () => {
    const v = Math.max(100, parseFloat(bal) || 10000);
    settings.set({ defaultBalance: v });
    broker.reset(v);
    setConfirm(false);
  };

  return (
    <div className="page">
      <div className="page-in" style={{ maxWidth: 760 }}>
        <div>
          <h1>Settings</h1>
          <p className="lead">Data sources, sound and your demo account.</p>
        </div>

        <div className="card">
          <h2>Market data</h2>
          <div className="info">
            <dt>Crypto</dt><dd>{f.status.crypto === 'live' ? 'Live from Binance (public feed, no key needed)' : f.status.crypto === 'sim' ? 'Simulated (Binance not reachable from here)' : f.status.crypto}</dd>
            <dt>Forex and gold</dt><dd>{f.status.forex === 'live' ? 'Live from Twelve Data' : 'Simulated around current reference rates'}</dd>
          </div>
          <div className="field">
            <label htmlFor="st-key">Twelve Data API key (optional, for live forex and gold)</label>
            <input id="st-key" className="input" type="password" autoComplete="off" spellCheck="false" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" />
            <p className="hint">Free keys are available at twelvedata.com. Live streaming and request limits depend on your plan. The key is stored only in this browser. If the limit is reached the app falls back to simulated prices automatically.</p>
          </div>
          <div className="inline">
            <button className="btn primary" onClick={saveKey}>Save key</button>
            {s.tdKey && <button className="btn" onClick={() => { setKey(''); settings.set({ tdKey: '' }); }}>Remove key</button>}
            {saved && <span className="up">Saved</span>}
          </div>
          <div className="notice info">Simulated prices move like a real market and fills still use bid, ask, fees and slippage, but they are not real quotes. Live data can also be a little delayed, so do not use this app to time real trades.</div>
        </div>

        <div className="card">
          <h2>Sound</h2>
          <label className="check"><input type="checkbox" checked={s.sound} onChange={(e) => settings.set({ sound: e.target.checked })} /> Play a sound when orders fill, stops hit or margin runs low</label>
        </div>

        <div className="card">
          <h2>Demo account</h2>
          <div className="info">
            <dt>Starting balance</dt><dd>{fmtUsd(broker.state.startBalance)}</dd>
            <dt>Current balance</dt><dd>{fmtUsd(broker.state.balance)}</dd>
            <dt>Closed trades</dt><dd>{broker.state.history.length}</dd>
          </div>
          <div className="field">
            <label htmlFor="st-bal">New starting balance (USD)</label>
            <input id="st-bal" className="input" type="number" min="100" value={bal} onChange={(e) => { setBal(e.target.value); setConfirm(false); }} />
            <div className="quick">
              {BALANCES.map((v) => <button key={v} onClick={() => { setBal(String(v)); setConfirm(false); }}>{v.toLocaleString('en-US')}</button>)}
            </div>
          </div>
          <div className="inline">
            {!confirm ? (
              <button className="btn danger" onClick={() => setConfirm(true)}>Reset account</button>
            ) : (
              <>
                <button className="btn danger" onClick={doReset}>Yes, erase positions, history and journal</button>
                <button className="btn" onClick={() => setConfirm(false)}>Keep my account</button>
              </>
            )}
            <button className="btn" onClick={exportCsv} disabled={!broker.state.history.length}>Export history (CSV)</button>
          </div>
          <p className="hint">Your account is saved in this browser only. Clearing site data removes it.</p>
        </div>

        <div className="card">
          <h2>How fills are simulated</h2>
          <ul className="prose" style={{ margin: 0, fontSize: 13 }}>
            <li>Buys fill at the ask and sells at the bid. Market orders take a fraction of a second to execute.</li>
            <li>Crypto market orders walk the order book, so large sizes get worse prices.</li>
            <li>Crypto fees: 0.04% taker and 0.02% maker. Funding is charged every 8 hours. Forex costs are the spread plus overnight swap at 22:00 UTC (triple on Wednesday).</li>
            <li>Stop-loss, take-profit, limit and stop orders trigger on live quotes while this page is open. They do not run when the page is closed.</li>
            <li>Margin level below 100% shows a warning. Below 50% your worst position is closed automatically.</li>
            <li>One position per instrument. An opposite order reduces, closes or flips it.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
