import { useEffect } from 'react';
import { startApp, ui, toasts } from './core.js';
import { useStore } from './store.js';
import Header from './components/Header.jsx';
import Trade from './views/Trade.jsx';
import Learn from './views/Learn.jsx';
import Backtest from './views/Backtest.jsx';
import Risk from './views/Risk.jsx';
import Journal from './views/Journal.jsx';
import Settings from './views/Settings.jsx';

function Toasts() {
  const { items } = useStore(toasts);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
      ))}
    </div>
  );
}

export default function App() {
  const { view } = useStore(ui);
  useEffect(() => {
    startApp();
  }, []);

  return (
    <div className="app">
      <Header />
      <main className="main">
        {/* The trading screen stays mounted so the chart keeps its state when you switch tabs. */}
        <div style={{ height: '100%', display: view === 'trade' ? 'block' : 'none' }}>
          <Trade />
        </div>
        {view === 'learn' && <Learn />}
        {view === 'backtest' && <Backtest />}
        {view === 'risk' && <Risk />}
        {view === 'journal' && <Journal />}
        {view === 'settings' && <Settings />}
      </main>
      <footer className="foot">
        Educational paper-trading simulator. Prices are real or simulated, money is virtual. Real trading involves risk of loss; nothing here is financial advice.
      </footer>
      <Toasts />
    </div>
  );
}
