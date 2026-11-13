// Small SVG line chart for equity curves. `values` is an array of numbers; `base` draws a dashed reference line.

const W = 640;
const H = 220;
const PAD = { l: 62, r: 12, t: 12, b: 20 };

export default function Curve({ values, base, fmt = (v) => v.toFixed(0), label = 'Equity curve' }) {
  if (!values || values.length < 2) return <div className="empty">Not enough data yet.</div>;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (base != null) { lo = Math.min(lo, base); hi = Math.max(hi, base); }
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const x = (i) => PAD.l + (i / (values.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const last = values[values.length - 1];
  const up = base == null ? last >= values[0] : last >= base;
  const color = up ? '#26c281' : '#ef5b5b';
  const area = `M${x(0)},${H - PAD.b} L${pts.join(' L')} L${x(values.length - 1)},${H - PAD.b} Z`;
  const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#1e2530" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end">{fmt(t)}</text>
        </g>
      ))}
      {base != null && <line x1={PAD.l} x2={W - PAD.r} y1={y(base)} y2={y(base)} stroke="#586071" strokeDasharray="4 4" />}
      <path d={area} fill={color} fillOpacity="0.1" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="3" fill={color} />
    </svg>
  );
}
