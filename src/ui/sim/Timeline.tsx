import type { TimelineSeries } from '../../engine/model';

/** Small hand-written SVG chart: demand vs capacity, errors shaded, queue depth when present. */
export function Timeline({ series }: { series: TimelineSeries }) {
  const pts = series.points;
  if (!pts.length) return null;
  const W = 320;
  const H = 86;
  const P = 4;
  const depthMode = pts.some((p) => (p.depth ?? 0) > 0);
  const maxX = pts[pts.length - 1].min || 1;
  const yMax = Math.max(1, ...pts.map((p) => (depthMode ? (p.depth ?? 0) : Math.max(p.demand, p.capacity))));
  const x = (m: number) => P + ((W - 2 * P) * m) / maxX;
  const y = (v: number) => H - P - ((H - 2 * P) * Math.min(v, yMax)) / yMax;
  const line = (f: (p: (typeof pts)[number]) => number) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.min).toFixed(1)},${y(f(p)).toFixed(1)}`).join(' ');
  const errArea = `M${x(pts[0].min)},${y(0)} ` + pts.map((p) => `L${x(p.min).toFixed(1)},${y(p.errors).toFixed(1)}`).join(' ') + ` L${x(maxX)},${y(0)} Z`;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={depthMode ? 'Queue depth over time' : 'Demand, capacity and errors over time'}>
        <rect x={0} y={0} width={W} height={H} rx={6} fill="var(--bg-2)" />
        {depthMode ? (
          <path d={line((p) => p.depth ?? 0)} fill="none" stroke="var(--c-integration)" strokeWidth={1.8} />
        ) : (
          <>
            <path d={errArea} fill="rgba(255,93,93,0.35)" />
            <path d={line((p) => p.capacity)} fill="none" stroke="var(--pass)" strokeWidth={1.5} strokeDasharray="4 3" />
            <path d={line((p) => p.demand)} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
          </>
        )}
        {(series.marks ?? []).filter((m) => m.label.includes('max')).slice(0, 1).map((m) => (
          <line key={m.min} x1={x(m.min)} x2={x(m.min)} y1={P} y2={H - P} stroke="var(--fail)" strokeDasharray="2 3" />
        ))}
      </svg>
      <figcaption className="hint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {depthMode ? (
          <span>
            <span style={{ color: 'var(--c-integration)' }}>━</span> queue depth (peak {Math.max(...pts.map((p) => p.depth ?? 0)).toLocaleString()}) over {Math.round(maxX)} min
          </span>
        ) : (
          <>
            <span><span style={{ color: 'var(--accent)' }}>━</span> demand rps</span>
            <span><span style={{ color: 'var(--pass)' }}>┅</span> capacity @70% CPU</span>
            <span><span style={{ color: 'var(--fail)' }}>■</span> errors</span>
            <span>{Math.round(maxX)} min</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
