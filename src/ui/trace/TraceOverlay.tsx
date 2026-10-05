import { useEffect, useLayoutEffect, useState } from 'react';
import type { Hop } from '../../engine/model';
import { useGame } from '../../store/game';
import { usePrefersReducedMotion } from '../shell/useMedia';
import { anchorSelector, subnetOfSelector } from './anchors';
import { useTraceStep } from './traceStep';

interface Pt {
  x: number;
  y: number;
  w: number;
  h: number;
  hop: Hop;
}

const COLORS = { allow: 'var(--pass)', deny: 'var(--fail)', info: 'var(--muted)' };

export function allHops(t: { hops: Hop[]; returnHops: Hop[] }): Hop[] {
  return [...t.hops, ...t.returnHops];
}

export function TraceOverlay() {
  const active = useGame((s) => s.activeTrace);
  const board = useGame((s) => s.board());
  const reducedSetting = useGame((s) => s.settings.reducedMotion);
  const prefersReduced = usePrefersReducedMotion();
  const reduced = reducedSetting || prefersReduced;
  const { step, set } = useTraceStep();
  const [pts, setPts] = useState<(Pt | null)[]>([]);
  const [tick, setTick] = useState(0);

  const hops = active ? allHops(active.trace) : [];
  const stopAt = hops.findIndex((h) => h.result === 'deny');
  const last = stopAt === -1 ? hops.length - 1 : stopAt;

  // Restart the animation for every new or replayed trace.
  useEffect(() => {
    if (!active) return;
    if (reduced) {
      set(last);
      return;
    }
    set(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      if (i > last) return clearInterval(t);
      set(i);
    }, 650);
    return () => clearInterval(t);
  }, [active?.nonce, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setTick((x) => x + 1);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  useLayoutEffect(() => {
    if (!active) return setPts([]);
    const root = document.querySelector('.board') as HTMLElement | null;
    if (!root) return;
    const base = root.getBoundingClientRect();
    let prevSubnet: string | null = null;
    const out: (Pt | null)[] = [];
    for (const h of hops) {
      const sel = anchorSelector(board, h, prevSubnet);
      prevSubnet = subnetOfSelector(board, h) ?? prevSubnet;
      const el = sel ? (root.querySelector(sel) as HTMLElement | null) : null;
      if (!el) {
        out.push(null);
        continue;
      }
      const r = el.getBoundingClientRect();
      out.push({ x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2, w: r.width, h: r.height, hop: h });
    }
    setPts(out);
  }, [active?.nonce, board, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active || !pts.length) return null;
  const visible = pts.slice(0, step + 1).filter((p): p is Pt => !!p);
  if (!visible.length) return null;
  const cur = visible[visible.length - 1];
  const curHop = hops[Math.min(step, hops.length - 1)];
  const path = visible.map((p) => `${p.x},${p.y}`).join(' ');
  return (
    <svg className="trace-overlay" width="100%" height="100%" aria-hidden>
      <polyline points={path} fill="none" stroke="var(--accent)" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="5 5" />
      {visible.map((p, i) => (
        <rect key={i} x={p.x - p.w / 2 - 3} y={p.y - p.h / 2 - 3} width={p.w + 6} height={p.h + 6} rx={9} fill="none" stroke={COLORS[p.hop.result]} strokeWidth={i === visible.length - 1 ? 2.5 : 1} strokeOpacity={i === visible.length - 1 ? 1 : 0.45} />
      ))}
      <circle className="trace-dot" cx={cur.x} cy={cur.y} r={7} fill={COLORS[curHop?.result ?? 'info']} stroke="#0a0e13" strokeWidth={2} />
    </svg>
  );
}
