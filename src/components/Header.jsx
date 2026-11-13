import { ui, useFeed, useBroker } from '../core.js';
import { useStore } from '../store.js';
import { fmtUsd } from '../lib/symbols.js';

const NAV = [
  ['trade', 'Trade'],
  ['learn', 'Learn'],
  ['backtest', 'Backtest'],
  ['risk', 'Risk'],
  ['journal', 'Journal'],
  ['settings', 'Settings'],
];

const LABEL = { live: 'Live', sim: 'Simulated', connecting: 'Connecting', reconnecting: 'Reconnecting' };

function Pill({ name, state }) {
  const cls = state === 'live' ? 'live' : 'sim';
  return (
    <span className={`pill ${cls}`} title={`${name} data: ${LABEL[state] || state}`}>
      <i />
      {name} {LABEL[state] || state}
    </span>
  );
}

export default function Header() {
  const f = useFeed();
  const b = useBroker();
  const { view } = useStore(ui);
  const m = b.metrics();
  const plClass = m.upl > 0 ? 'up' : m.upl < 0 ? 'down' : '';
  const levelClass = m.level < 1 ? 'down' : m.level < 1.5 ? 'warn' : '';

  return (
    <header className="hdr">
      <div className="brand">
        Trade Academy <span className="badge">DEMO</span>
      </div>
      <nav className="nav" aria-label="Sections">
        {NAV.map(([id, label]) => (
          <button key={id} className={view === id ? 'on' : ''} onClick={() => ui.set({ view: id })}>
            {label}
          </button>
        ))}
      </nav>
      <div className="pills">
        <Pill name="Crypto" state={f.status.crypto} />
        <Pill name="Forex" state={f.status.forex} />
      </div>
      <div className="acct">
        <div className="m"><span>Balance</span><span>{fmtUsd(m.balance)}</span></div>
        <div className="m"><span>Equity</span><span>{fmtUsd(m.equity)}</span></div>
        <div className="m"><span>Open P/L</span><span className={plClass}>{fmtUsd(m.upl)}</span></div>
        <div className="m"><span>Margin</span><span>{fmtUsd(m.used)}</span></div>
        <div className="m"><span>Free</span><span>{fmtUsd(m.free)}</span></div>
        <div className="m"><span>Level</span><span className={levelClass}>{m.used > 0 ? `${(m.level * 100).toFixed(0)}%` : '–'}</span></div>
      </div>
    </header>
  );
}
