import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { sgEdges } from '../../engine/net/sgGraph';
import { useGame } from '../../store/game';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function SecurityOverlay() {
  const on = useGame((s) => s.securityView);
  const board = useGame((s) => s.board());
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [tick, setTick] = useState(0);
  const edges = useMemo(() => (on ? sgEdges(board) : []), [on, board]);

  useEffect(() => {
    if (!on) return;
    const bump = () => setTick((x) => x + 1);
    window.addEventListener('resize', bump);
    const ro = new ResizeObserver(bump);
    const root = document.querySelector('.board');
    if (root) ro.observe(root);
    return () => {
      window.removeEventListener('resize', bump);
      ro.disconnect();
    };
  }, [on]);

  useLayoutEffect(() => {
    if (!on) return setBoxes({});
    const root = document.querySelector('.board') as HTMLElement | null;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const out: Record<string, Box> = {};
    for (const id of new Set(edges.flatMap((e) => [e.from, e.to]))) {
      const el = root.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out[id] = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    }
    setBoxes(out);
  }, [on, edges, tick]);

  if (!on) return null;
  return (
    <svg className="sg-overlay" width="100%" height="100%" aria-hidden>
      <defs>
        <marker id="sg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--info)" />
        </marker>
        <marker id="sg-arrow-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--fail)" />
        </marker>
      </defs>
      {edges.map((e, i) => {
        const a = boxes[e.from];
        const b = boxes[e.to];
        if (!a || !b) return null;
        // From the bottom of the source to the top of the target, bending to the right so arrows that share a column stay apart.
        const x1 = e.from === 'internet' ? a.x + 10 : a.x + a.w / 2;
        const y1 = a.y + a.h;
        const x2 = b.x + Math.min(b.w / 2, 60 + (i % 3) * 18);
        const y2 = b.y;
        const bend = Math.max(30, Math.abs(y2 - y1) * 0.25);
        const mx = (x1 + x2) / 2 + bend;
        const my = (y1 + y2) / 2;
        const color = e.open ? 'var(--fail)' : 'var(--info)';
        const label = `${e.ports.join(', ')}${e.open ? ' from 0.0.0.0/0' : ''}`;
        return (
          <g key={`${e.from}>${e.to}`}>
            <path d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke={color} strokeWidth={e.open ? 2.2 : 1.6} strokeDasharray={e.from === 'internet' && !e.open ? '5 4' : undefined} markerEnd={`url(#${e.open ? 'sg-arrow-open' : 'sg-arrow'})`} opacity={0.9} />
            {/* Label near the receiving end, where the eye already is. */}
            <g transform={`translate(${0.04 * x1 + 0.32 * mx + 0.64 * x2}, ${0.04 * y1 + 0.32 * my + 0.64 * y2 - 6})`}>
              <rect x={-label.length * 3.3 - 6} y={-9} width={label.length * 6.6 + 12} height={18} rx={9} fill="var(--panel-3)" stroke={color} strokeOpacity={0.6} />
              <text textAnchor="middle" dy="4" fontSize="11" fontFamily="var(--font-mono)" fill={e.open ? 'var(--fail)' : 'var(--text)'}>
                {label}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
