import { useRef } from 'react';
import { ui, useFeed } from '../core.js';
import { useStore } from '../store.js';
import { SYMBOLS, getSym, fmtPrice } from '../lib/symbols.js';

export default function Watchlist() {
  const f = useFeed();
  const s = useStore(ui);
  const prev = useRef({});
  const dir = useRef({});

  const addable = SYMBOLS.filter((x) => !s.watch.includes(x.id));

  return (
    <div className="watch">
      <div className="head">
        <span>Markets</span>
        <select
          aria-label="Add instrument"
          value=""
          onChange={(e) => {
            if (e.target.value) ui.set((st) => ({ watch: [...st.watch, e.target.value] }));
          }}
        >
          <option value="">+ Add</option>
          {addable.map((x) => (
            <option key={x.id} value={x.id}>{x.base}/{x.quote}</option>
          ))}
        </select>
      </div>
      <ul>
        {s.watch.map((id) => {
          const sym = getSym(id);
          const q = f.quotes[id];
          if (!sym || !q) return null;
          const p = prev.current[id];
          if (p != null && q.last !== p) dir.current[id] = q.last > p ? 'up' : 'down';
          prev.current[id] = q.last;
          const chg = q.open24 ? (q.last / q.open24 - 1) * 100 : 0;
          return (
            <li key={id} className={s.symbol === id ? 'on' : ''} onClick={() => ui.set({ symbol: id })}>
              <span className="sym">{sym.base}/{sym.quote}</span>
              <span className={`px ${dir.current[id] || ''}`}>{fmtPrice(sym, q.last)}</span>
              <span className="nm">{sym.name}</span>
              <span className={`ch ${chg >= 0 ? 'up' : 'down'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
              {s.watch.length > 1 && (
                <button
                  className="rm"
                  aria-label={`Remove ${sym.base}/${sym.quote}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    ui.set((st) => ({ watch: st.watch.filter((x) => x !== id) }));
                  }}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
