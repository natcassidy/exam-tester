import { useState } from 'react';
import { requirementStatus } from '../../engine/sim/runner';
import { useGame } from '../../store/game';

/** Keeps the mission's requirements in view while the console or tracer covers the brief. */
export function RequirementsStrip() {
  const mission = useGame((s) => s.mission());
  const results = useGame((s) => s.results[mission.id]);
  const select = useGame((s) => s.select);
  const openTrace = useGame((s) => s.openTrace);
  const [open, setOpen] = useState(false);
  const status = results ? requirementStatus(mission, results) : null;
  const met = status ? Object.values(status).filter((v) => v === 'met').length : 0;
  const mark = (id: string) => (status?.[id] === 'met' ? '✓' : status?.[id] === 'missed' ? '✗' : '○');
  const cls = (id: string) => status?.[id] ?? 'idle';
  return (
    <div className={`req-strip ${open ? 'open' : ''}`}>
      <div className="req-strip-head">
        <button
          className="btn ghost small"
          onClick={() => {
            openTrace(false);
            select(null);
          }}
        >
          ← Brief
        </button>
        <button className="req-strip-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="hint">Requirements {status ? `${met}/${mission.requirements.length}` : ''}</span>
          <span className="req-marks" aria-hidden>
            {mission.requirements.map((r) => (
              <span key={r.id} className={`mark ${cls(r.id)}`}>
                {mark(r.id)}
              </span>
            ))}
          </span>
          <span className="caret" aria-hidden>
            {open ? '▴' : '▾'}
          </span>
        </button>
      </div>
      {open && (
        <div className="req-strip-list">
          {mission.requirements.map((r) => (
            <div key={r.id} className="req">
              <span className={`mark ${cls(r.id)}`}>{mark(r.id)}</span>
              <span>{r.text}</span>
            </div>
          ))}
          {!status && <p className="hint">Run the simulation to tick these off.</p>}
        </div>
      )}
    </div>
  );
}
