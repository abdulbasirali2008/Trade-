import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, LineStyle, ColorType } from 'lightweight-charts';
import { feed, broker, ui, draft, useBroker, useFeed } from '../core.js';
import { useStore } from '../store.js';
import { TIMEFRAMES, getSym, fmtPrice, fmtQty } from '../lib/symbols.js';
import { sma, ema, rsi, macd, bollinger, toLine } from '../lib/indicators.js';

const COL = {
  bg: '#0d1117', grid: '#161c26', text: '#7d8696', line: '#1e2530', faint: '#586071',
  up: '#26c281', down: '#ef5b5b', ma20: '#f5c542', ma50: '#5aa9ff', ema: '#c792ea', bb: '#7d8696',
};

const baseOpts = (extra = {}) => ({
  autoSize: true,
  layout: { background: { type: ColorType.Solid, color: COL.bg }, textColor: COL.text, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 },
  grid: { vertLines: { color: COL.grid }, horzLines: { color: COL.grid } },
  rightPriceScale: { borderColor: COL.line, minimumWidth: 72 },
  timeScale: { borderColor: COL.line, timeVisible: true, secondsVisible: false, rightOffset: 6 },
  crosshair: { mode: CrosshairMode.Normal },
  ...extra,
});

const subOpts = () => baseOpts({ timeScale: { visible: false, rightOffset: 6 }, handleScroll: false, handleScale: false });

// Same length as the candles (whitespace where undefined) so sub-chart bar indexes line up with the main chart.
const full = (bars, values) => bars.map((b, i) => (values[i] != null && Number.isFinite(values[i]) ? { time: b.time, value: values[i] } : { time: b.time }));

const IND_CHIPS = [
  ['sma20', 'SMA 20'], ['sma50', 'SMA 50'], ['ema20', 'EMA 20'], ['bb', 'Bollinger'], ['vol', 'Volume'], ['rsi', 'RSI'], ['macd', 'MACD'],
];

function QuoteBar() {
  const f = useFeed();
  const { symbol } = useStore(ui);
  const sym = getSym(symbol);
  const q = f.quotes[symbol];
  const prev = useRef(q.last);
  const dir = useRef('');
  if (q.last !== prev.current) { dir.current = q.last > prev.current ? 'up' : 'down'; prev.current = q.last; }
  const chg = q.open24 ? (q.last / q.open24 - 1) * 100 : 0;
  const spread = sym.market === 'forex' ? `${((q.ask - q.bid) / sym.pip).toFixed(1)} pips` : fmtPrice(sym, q.ask - q.bid);
  return (
    <div className="quote">
      <span className="name">{sym.base}/{sym.quote}</span>
      <span className={`last ${dir.current}`}>{fmtPrice(sym, q.last)}</span>
      <span className={`sub ${chg >= 0 ? 'up' : 'down'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
      <span className="sub">Bid {fmtPrice(sym, q.bid)}</span>
      <span className="sub">Ask {fmtPrice(sym, q.ask)}</span>
      <span className="sub">Spread {spread}</span>
      <span className={`pill ${q.src === 'live' ? 'live' : 'sim'}`}><i />{f.sourceLabel(symbol)}</span>
    </div>
  );
}

export default function Chart() {
  const s = useStore(ui);
  useBroker();
  const { symbol, tf, indicators: ind, tool, lines } = s;
  const brokerVersion = broker.getVersion();

  const hostRef = useRef(null);
  const rsiEl = useRef(null);
  const macdEl = useRef(null);
  const legendRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const seriesRef = useRef({});
  const subRef = useRef({});
  const barsRef = useRef([]);
  const priceLinesRef = useRef([]);
  const readyRef = useRef(false);
  const timerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [realData, setRealData] = useState(true);
  const [tick, setTick] = useState(0);

  // Recompute every active indicator from the current candles.
  const applyIndicators = () => {
    const bars = barsRef.current;
    if (!bars.length) return;
    const closes = bars.map((b) => b.close);
    const se = seriesRef.current;
    if (se.sma20) se.sma20.setData(toLine(bars, sma(closes, 20)));
    if (se.sma50) se.sma50.setData(toLine(bars, sma(closes, 50)));
    if (se.ema20) se.ema20.setData(toLine(bars, ema(closes, 20)));
    if (se.bb) {
      const b = bollinger(closes, 20, 2);
      se.bb.u.setData(toLine(bars, b.upper));
      se.bb.m.setData(toLine(bars, b.mid));
      se.bb.l.setData(toLine(bars, b.lower));
    }
    if (se.vol) se.vol.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? '#26c28144' : '#ef5b5b44' })));
    const sub = subRef.current;
    if (sub.rsi) sub.rsi.series.setData(full(bars, rsi(closes, 14)));
    if (sub.macd) {
      const m = macd(closes);
      sub.macd.hist.setData(bars.map((b, i) => (m.hist[i] != null ? { time: b.time, value: m.hist[i], color: m.hist[i] >= 0 ? '#26c28199' : '#ef5b5b99' } : { time: b.time })));
      sub.macd.line.setData(full(bars, m.line));
      sub.macd.signal.setData(full(bars, m.signal));
    }
  };

  const scheduleIndicators = () => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => { timerRef.current = null; applyIndicators(); }, 400);
  };

  // ----- create the chart once -----
  useEffect(() => {
    const chart = createChart(hostRef.current, baseOpts());
    const candle = chart.addCandlestickSeries({
      upColor: COL.up, downColor: COL.down, borderUpColor: COL.up, borderDownColor: COL.down, wickUpColor: COL.up, wickDownColor: COL.down,
    });
    chartRef.current = chart;
    candleRef.current = candle;

    chart.subscribeClick((param) => {
      if (!param.point) return;
      const raw = candle.coordinateToPrice(param.point.y);
      if (raw == null) return;
      const st = ui.get();
      const price = Number(raw.toFixed(getSym(st.symbol).decimals));
      if (st.tool === 'hline') {
        ui.set((x) => ({ lines: { ...x.lines, [x.symbol]: [...(x.lines[x.symbol] || []), price] } }));
      } else {
        draft.set({ price, stamp: Date.now() });
      }
    });

    chart.subscribeCrosshairMove((param) => {
      const el = legendRef.current;
      if (!el) return;
      const sym = getSym(ui.get().symbol);
      const d = param.seriesData && param.seriesData.get(candle);
      const bars = barsRef.current;
      const b = d || bars[bars.length - 1];
      if (!b || b.open == null) { el.textContent = ''; return; }
      el.textContent = `O ${fmtPrice(sym, b.open)}  H ${fmtPrice(sym, b.high)}  L ${fmtPrice(sym, b.low)}  C ${fmtPrice(sym, b.close)}`;
    });

    const offBar = feed.onBar((id, tfId, bar) => {
      const st = ui.get();
      if (!readyRef.current || id !== st.symbol || tfId !== st.tf || !candleRef.current) return;
      const arr = barsRef.current;
      const last = arr[arr.length - 1];
      if (bar !== last) {
        if (last && bar.time === last.time) arr[arr.length - 1] = bar;
        else if (!last || bar.time > last.time) arr.push(bar);
        else return;
      }
      candleRef.current.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
      scheduleIndicators();
    });

    return () => {
      offBar();
      clearTimeout(timerRef.current);
      timerRef.current = null;
      readyRef.current = false;
      try { chart.remove(); } catch (e) { /* already removed */ }
      chartRef.current = null;
      candleRef.current = null;
      seriesRef.current = {};
      subRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- load candles when the symbol or timeframe changes -----
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart) return undefined;
    let cancelled = false;
    const sym = getSym(symbol);
    readyRef.current = false;
    barsRef.current = [];
    candle.setData([]);
    candle.applyOptions({ priceFormat: { type: 'price', precision: sym.decimals, minMove: Math.pow(10, -sym.decimals) } });
    setLoading(true);
    feed.setActive(symbol, tf);
    feed.getCandles(symbol, tf, 500).then((bars) => {
      if (cancelled) return;
      barsRef.current = bars;
      candle.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
      feed.attachBars(symbol, tf, bars);
      readyRef.current = true;
      applyIndicators();
      const n = bars.length;
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 130), to: n + 6 });
      setRealData(feed.candlesAreReal(symbol, tf));
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf]);

  // ----- overlay series (moving averages, bands, volume) -----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const se = seriesRef.current;
    const lineOpts = (color) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const toggle = (key, on, make, destroy) => {
      if (on && !se[key]) se[key] = make();
      else if (!on && se[key]) { destroy(se[key]); delete se[key]; }
    };
    const one = (color) => [() => chart.addLineSeries(lineOpts(color)), (x) => chart.removeSeries(x)];
    toggle('sma20', ind.sma20, ...one(COL.ma20));
    toggle('sma50', ind.sma50, ...one(COL.ma50));
    toggle('ema20', ind.ema20, ...one(COL.ema));
    toggle('bb', ind.bb,
      () => ({ u: chart.addLineSeries(lineOpts(COL.bb)), m: chart.addLineSeries({ ...lineOpts(COL.bb), lineStyle: LineStyle.Dotted }), l: chart.addLineSeries(lineOpts(COL.bb)) }),
      (x) => { chart.removeSeries(x.u); chart.removeSeries(x.m); chart.removeSeries(x.l); });
    toggle('vol', ind.vol,
      () => {
        const v = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
        return v;
      },
      (x) => chart.removeSeries(x));
    applyIndicators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ind.sma20, ind.sma50, ind.ema20, ind.bb, ind.vol]);

  // ----- RSI sub chart -----
  useEffect(() => {
    if (!ind.rsi || !chartRef.current) return undefined;
    const main = chartRef.current;
    const sub = createChart(rsiEl.current, subOpts());
    const series = sub.addLineSeries({
      color: COL.ema, lineWidth: 2, priceLineVisible: false,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });
    [70, 30].forEach((price) => series.createPriceLine({ price, color: COL.faint, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false }));
    subRef.current.rsi = { chart: sub, series };
    const sync = (r) => { if (r) sub.timeScale().setVisibleLogicalRange(r); };
    main.timeScale().subscribeVisibleLogicalRangeChange(sync);
    sync(main.timeScale().getVisibleLogicalRange());
    applyIndicators();
    return () => {
      try { main.timeScale().unsubscribeVisibleLogicalRangeChange(sync); } catch (e) { /* main removed first */ }
      try { sub.remove(); } catch (e) { /* ignore */ }
      delete subRef.current.rsi;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ind.rsi]);

  // ----- MACD sub chart -----
  useEffect(() => {
    if (!ind.macd || !chartRef.current) return undefined;
    const main = chartRef.current;
    const sub = createChart(macdEl.current, subOpts());
    const hist = sub.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    const line = sub.addLineSeries({ color: COL.ma50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const signal = sub.addLineSeries({ color: COL.ma20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    subRef.current.macd = { chart: sub, hist, line, signal };
    const sync = (r) => { if (r) sub.timeScale().setVisibleLogicalRange(r); };
    main.timeScale().subscribeVisibleLogicalRangeChange(sync);
    sync(main.timeScale().getVisibleLogicalRange());
    applyIndicators();
    return () => {
      try { main.timeScale().unsubscribeVisibleLogicalRangeChange(sync); } catch (e) { /* main removed first */ }
      try { sub.remove(); } catch (e) { /* ignore */ }
      delete subRef.current.macd;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ind.macd]);

  // The liquidation estimate moves with price, so refresh the lines now and then while a position is open.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 3000);
    return () => clearInterval(t);
  }, []);

  // ----- price lines: positions, orders and your own horizontal lines -----
  useEffect(() => {
    const cs = candleRef.current;
    if (!cs) return;
    priceLinesRef.current.forEach((l) => { try { cs.removePriceLine(l); } catch (e) { /* ignore */ } });
    priceLinesRef.current = [];
    const sym = getSym(symbol);
    const add = (price, color, title, style = LineStyle.Dashed, width = 1) => {
      if (!price || !Number.isFinite(price)) return;
      priceLinesRef.current.push(cs.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }));
    };
    for (const p of broker.state.positions) {
      if (p.symbol !== symbol) continue;
      add(p.entry, '#5aa9ff', `${p.side === 'long' ? 'LONG' : 'SHORT'} ${fmtQty(sym, p.qty)}`, LineStyle.Solid);
      add(p.sl, COL.down, 'SL');
      add(p.tp, COL.up, 'TP');
      add(broker.liqPrice(p), '#ff9f43', 'LIQ', LineStyle.Dotted);
    }
    for (const o of broker.state.orders) {
      if (o.symbol === symbol) add(o.price, '#9aa4b5', `${o.type.toUpperCase()} ${o.side}`);
    }
    (lines[symbol] || []).forEach((price, i) => add(price, '#d7dce4', `H${i + 1}`));
  }, [brokerVersion, symbol, lines, tick]);

  const toggleInd = (key) => ui.set((st) => ({ indicators: { ...st.indicators, [key]: !st.indicators[key] } }));
  const hasLines = (lines[symbol] || []).length > 0;

  return (
    <section className="chart-pane" aria-label="Price chart">
      <div className="chart-bar">
        <div className="seg" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button key={t.id} className={tf === t.id ? 'on' : ''} onClick={() => ui.set({ tf: t.id })}>{t.id}</button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Indicators">
          {IND_CHIPS.map(([key, label]) => (
            <button key={key} className={`chipbtn ${ind[key] ? 'on' : ''}`} onClick={() => toggleInd(key)} aria-pressed={!!ind[key]}>{label}</button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Tools">
          <button className={`chipbtn ${tool === 'hline' ? 'on' : ''}`} onClick={() => ui.set({ tool: tool === 'hline' ? 'cursor' : 'hline' })} aria-pressed={tool === 'hline'}>
            H-line
          </button>
          {hasLines && (
            <button className="chipbtn" onClick={() => ui.set((st) => ({ lines: { ...st.lines, [st.symbol]: [] } }))}>Clear lines</button>
          )}
        </div>
      </div>
      <QuoteBar />
      <div className="chart-stack">
        <div className="chart-main">
          <div ref={hostRef} className="chart-host" />
          <div ref={legendRef} className="legend" />
          {loading && <div className="chart-loading">Loading candles…</div>}
        </div>
        <div className="sub" hidden={!ind.rsi}>
          <span className="lbl">RSI 14</span>
          <div ref={rsiEl} style={{ position: 'absolute', inset: 0 }} />
        </div>
        <div className="sub" hidden={!ind.macd}>
          <span className="lbl">MACD 12 26 9</span>
          <div ref={macdEl} style={{ position: 'absolute', inset: 0 }} />
        </div>
      </div>
      <p className="chart-hint">
        {!realData && !loading
          ? 'History is simulated because no live source is connected for this chart. '
          : ''}
        {tool === 'hline' ? 'H-line tool: click the chart to draw a level.' : 'Click the chart to pick a price for limit and stop orders.'}
      </p>
    </section>
  );
}
