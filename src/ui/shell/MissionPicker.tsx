import { useEffect, useRef, useState } from 'react';
import { ALL_MISSIONS } from '../../content/missions';
import type { Mission } from '../../engine/model';
import { Mode, modeOf, useGame } from '../../store/game';
import { Stars } from './Abbr';

const STAGE: Record<number, string> = {
  1: 'Depth',
  2: 'Investigation',
  3: 'Breadth: multi-Region, hybrid, storage, data',
  4: 'Refactor for cost',
};

export function missionsIn(mode: Mode): Mission[] {
  return ALL_MISSIONS.filter((m) => modeOf(m) === mode);
}

/** The mission after `id` in its mode's list, or null on the last one. */
export function nextMission(id: string): Mission | null {
  const m = ALL_MISSIONS.find((x) => x.id === id);
  if (!m) return null;
  const list = missionsIn(modeOf(m));
  return list[list.indexOf(m) + 1] ?? null;
}

/** Current mission with previous/next arrows, and a list of every mission in this mode with its stars. */
export function MissionPicker() {
  const current = useGame((s) => s.currentMissionId);
  const best = useGame((s) => s.best);
  const setMission = useGame((s) => s.setMission);
  const mission = useGame((s) => s.mission());
  const list = missionsIn(modeOf(mission));
  const i = list.findIndex((m) => m.id === current);
  const done = list.filter((m) => (best[m.id]?.stars ?? 0) > 0).length;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const go = (id: string) => {
    setMission(id);
    setOpen(false);
  };
  const n = (k: number) => String(k + 1).padStart(2, '0');

  return (
    <div className="picker" ref={root}>
      <button className="btn ghost picker-step" onClick={() => i > 0 && go(list[i - 1].id)} disabled={i <= 0} aria-label="Previous mission">
        ‹
      </button>
      <button className="picker-current" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="listbox">
        <span className="n">
          {n(i)}/{list.length}
        </span>
        <span className="t">{mission.title}</span>
        <Stars n={best[current]?.stars ?? 0} />
        <span className="caret" aria-hidden>
          ▾
        </span>
      </button>
      <button className="btn ghost picker-step" onClick={() => i < list.length - 1 && go(list[i + 1].id)} disabled={i >= list.length - 1} aria-label="Next mission">
        ›
      </button>
      {open && (
        <div className="picker-menu" role="listbox" aria-label="Missions">
          <div className="picker-sum hint">
            {done} of {list.length} cleared
          </div>
          {list.map((m, k) => (
            <div key={m.id}>
              {(k === 0 || m.stage !== list[k - 1].stage) && list.some((x) => x.stage !== list[0].stage) && <div className="picker-stage">{STAGE[m.stage] ?? `Stage ${m.stage}`}</div>}
              <button role="option" aria-selected={m.id === current} className={`picker-item ${m.id === current ? 'on' : ''}`} onClick={() => go(m.id)}>
                <span className="n">{n(k)}</span>
                <span className="t">
                  {m.title}
                  <small>{m.client}</small>
                </span>
                <Stars n={best[m.id]?.stars ?? 0} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
