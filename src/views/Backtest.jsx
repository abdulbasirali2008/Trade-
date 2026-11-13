import { useState } from 'react';
import { feed } from '../core.js';
import Curve from '../components/Curve.jsx';
import { SYMBOLS, TIMEFRAMES, getSym, fmtPrice, fmtUsd } from '../lib/symbols.js';
import { STRATEGIES, defaultParams, runBacktest } from '../lib/backtest.js';

const dt = (sec) => new Date(sec * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
const pct = (v, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;

export default function Backtest() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [tf, setTf] = useState('1h');
  const [strategy, setStrategy] = useState('sma');
  const [params, setParams] = useState(defaultParams('sma'));
  const [longOnly, setLongOnly] = useState(false);
  const [sizePct, setSizePct] = useState(100);
  const [slPct, setSlPct] = useState(0);
  const [tpPct, setTpPct] = useState(0);
  const [feePct, setFeePct] = useState(0.04);
  const [slipPct, setSlipPct] = useState(0.01);
  const [balance, setBalance] = useState(10000);
  const [state, setState] = useState({ busy: false, res: null, real: true, err: '', meta: null });

  const strat = STRATEGIES.find((s) => s.id === strategy);

  const changeStrategy = (id) => {
    setStrategy(id);
    setParams(defaultParams(id));
  };

  const run = async () => {
    setState((s) => ({ ...s, busy: true, err: '' }));
    try {
      const candles = await feed.getCandles(symbol, tf, 1000);
      const res = runBacktest(candles, { strategy, params, longOnly, sizePct, slPct, tpPct, feePct, slipPct, startBalance: balance });
      setState({
        busy: false, res, err: '', real: feed.candlesAreReal(symbol, tf),
        meta: { symbol, tf, from: candles[0].time, to: candles[candles.length - 1].time, bars: candles.length },
      });
    } catch (e) {
      setState((s) => ({ ...s, busy: false, err: 'The test could not run. Check the settings and try again.' }));
    }
  };

  const { res, meta } = state;
  const st = res?.stats;
  const sym = meta ? getSym(meta.symbol) : null;

  return (
    <div className="page">
      <div className="page-in">
        <div>
          <h1>Backtest</h1>
          <p className="lead">Test a rule-based idea on up to 1,000 past candles before you risk anything. Signals are read at a candle's close and traded at the next open, with fees and slippage included.</p>
        </div>
        <div className="cols">
          <div className="card">
            <h2>Setup</h2>
            <div className="row2">
              <div className="field">
                <label htmlFor="bt-sym">Instrument</label>
                <select id="bt-sym" className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                  {SYMBOLS.map((x) => <option key={x.id} value={x.id}>{x.base}/{x.quote}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="bt-tf">Timeframe</label>
                <select id="bt-tf" className="input" value={tf} onChange={(e) => setTf(e.target.value)}>
                  {TIMEFRAMES.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="bt-strat">Strategy</label>
              <select id="bt-strat" className="input" value={strategy} onChange={(e) => changeStrategy(e.target.value)}>
                {STRATEGIES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <p className="hint">{strat.desc}</p>
            </div>
            {strat.params.length > 0 && (
              <div className="params">
                {strat.params.map((p) => (
                  <div className="field" key={p.key}>
                    <label htmlFor={`bt-${p.key}`}><span>{p.label}</span><span className="mono">{params[p.key]}</span></label>
                    <input id={`bt-${p.key}`} type="range" min={p.min} max={p.max} step={p.step} value={params[p.key]} onChange={(e) => setParams((x) => ({ ...x, [p.key]: +e.target.value }))} />
                  </div>
                ))}
              </div>
            )}
            <label className="check"><input type="checkbox" checked={longOnly} onChange={(e) => setLongOnly(e.target.checked)} /> Long trades only</label>
            <div className="row2">
              <div className="field">
                <label htmlFor="bt-size">Size (% of equity)</label>
                <input id="bt-size" className="input" type="number" min="1" max="100" value={sizePct} onChange={(e) => setSizePct(Math.min(100, Math.max(1, +e.target.value || 1)))} />
              </div>
              <div className="field">
                <label htmlFor="bt-bal">Start balance (USD)</label>
                <input id="bt-bal" className="input" type="number" min="100" value={balance} onChange={(e) => setBalance(Math.max(100, +e.target.value || 100))} />
              </div>
              <div className="field">
                <label htmlFor="bt-sl">Stop-loss (%)</label>
                <input id="bt-sl" className="input" type="number" min="0" step="0.1" value={slPct} onChange={(e) => setSlPct(Math.max(0, +e.target.value || 0))} />
              </div>
              <div className="field">
                <label htmlFor="bt-tp">Take-profit (%)</label>
                <input id="bt-tp" className="input" type="number" min="0" step="0.1" value={tpPct} onChange={(e) => setTpPct(Math.max(0, +e.target.value || 0))} />
              </div>
              <div className="field">
                <label htmlFor="bt-fee">Fee per side (%)</label>
                <input id="bt-fee" className="input" type="number" min="0" step="0.01" value={feePct} onChange={(e) => setFeePct(Math.max(0, +e.target.value || 0))} />
              </div>
              <div className="field">
                <label htmlFor="bt-slip">Slippage (%)</label>
                <input id="bt-slip" className="input" type="number" min="0" step="0.01" value={slipPct} onChange={(e) => setSlipPct(Math.max(0, +e.target.value || 0))} />
              </div>
            </div>
            <button className="btn primary" onClick={run} disabled={state.busy}>{state.busy ? 'Running…' : 'Run backtest'}</button>
            {state.err && <div className="notice">{state.err}</div>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {!res && <div className="card"><div className="empty">Choose a strategy and press Run backtest.</div></div>}
            {res && (
              <>
                {!state.real && <div className="notice">These candles are simulated because no live data source answered. Use them to learn the tool, not to judge a strategy.</div>}
                <div className="card">
                  <h2>{sym.base}/{sym.quote} · {meta.tf} · {meta.bars} candles <span className="muted" style={{ fontWeight: 400 }}>({dt(meta.from)} – {dt(meta.to)})</span></h2>
                  <div className="stats">
                    <div className="stat"><span>Net result</span><span className={st.net >= 0 ? 'up' : 'down'}>{fmtUsd(st.net)}</span></div>
                    <div className="stat"><span>Return</span><span className={st.returnPct >= 0 ? 'up' : 'down'}>{pct(st.returnPct)}</span></div>
                    <div className="stat"><span>Buy and hold</span><span className={st.buyHoldPct >= 0 ? 'up' : 'down'}>{pct(st.buyHoldPct)}</span></div>
                    <div className="stat"><span>Trades</span><span>{st.count}</span></div>
                    <div className="stat"><span>Win rate</span><span>{(st.winRate * 100).toFixed(0)}%</span></div>
                    <div className="stat"><span>Profit factor</span><span>{Number.isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : '∞'}</span></div>
                    <div className="stat"><span>Max drawdown</span><span className="down">-{st.maxDrawdownPct.toFixed(1)}%</span></div>
                    <div className="stat"><span>Avg win / loss</span><span>{fmtUsd(st.avgWin, 0)} / {fmtUsd(st.avgLoss, 0)}</span></div>
                    <div className="stat"><span>Costs paid</span><span>{fmtUsd(st.fees, 0)}</span></div>
                  </div>
                  <Curve values={res.curve.map((p) => p.equity)} base={balance} fmt={(v) => fmtUsd(v, 0)} />
                </div>
                <div className="notice info">A good result on past data does not mean the idea will work next month. Strategies tuned until they look good on one period often fail on new data (overfitting). Try other instruments and timeframes before trusting a result.</div>
                <div className="card">
                  <h2>Trades</h2>
                  {res.trades.length === 0 ? <div className="empty">The strategy did not trade in this period.</div> : (
                    <div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}>
                      <table>
                        <thead><tr><th>Opened</th><th>Side</th><th className="r">Entry</th><th className="r">Exit</th><th className="r">P/L</th><th className="r">Return</th><th>Exit</th></tr></thead>
                        <tbody>
                          {res.trades.slice(-60).reverse().map((t, i) => (
                            <tr key={i}>
                              <td>{dt(t.openTime)}</td>
                              <td><span className={`side-tag ${t.dir > 0 ? 'long' : 'short'}`}>{t.dir > 0 ? 'LONG' : 'SHORT'}</span></td>
                              <td className="r">{fmtPrice(sym, t.entry)}</td>
                              <td className="r">{fmtPrice(sym, t.exit)}</td>
                              <td className={`r ${t.pnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(t.pnl)}</td>
                              <td className={`r ${t.ret >= 0 ? 'up' : 'down'}`}>{pct(t.ret * 100, 2)}</td>
                              <td className="t">{t.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
