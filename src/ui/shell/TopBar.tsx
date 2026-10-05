import { Fragment, useRef } from 'react';
import { ALL_MISSIONS } from '../../content/missions';
import { Mode, modeOf, useGame } from '../../store/game';

const MODES: { id: Mode; label: string; short: string }[] = [
  { id: 'build', label: 'Build', short: 'Build' },
  { id: 'incident', label: 'Incidents', short: 'Incidents' },
  { id: 'diff', label: 'Spot the Difference', short: 'Diff' },
];
import { Stars } from './Abbr';

export function TopBar() {
  const current = useGame((s) => s.currentMissionId);
  const best = useGame((s) => s.best);
  const setMission = useGame((s) => s.setMission);
  const setMode = useGame((s) => s.setMode);
  const select = useGame((s) => s.select);
  const mission = useGame((s) => s.mission());
  const mode = modeOf(mission);
  const missions = ALL_MISSIONS.filter((m) => modeOf(m) === mode);
  const openManual = useGame((s) => s.openManual);
  const openTrace = useGame((s) => s.openTrace);
  const exportProgress = useGame((s) => s.exportProgress);
  const importProgress = useGame((s) => s.importProgress);
  const toast = useGame((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    try {
      const blob = new Blob([exportProgress()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blast-radius-progress-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Progress exported.', 'success');
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    }
  };

  return (
    <header className="topbar">
      <div className="logo">
        BLAST<b>/</b>RADIUS
      </div>
      <div className="modes" role="tablist" aria-label="Game mode">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}>
            <span className="long">{m.label}</span>
            <span className="short">{m.short}</span>
          </button>
        ))}
      </div>
      <nav className="chips" aria-label="Missions">
        {missions.map((m, i) => (
          <Fragment key={m.id}>
            {i > 0 && m.stage !== missions[i - 1].stage && (
              <span className="chip-divider" aria-hidden>
                {m.stage === 3 ? 'Breadth' : `Stage ${m.stage}`}
              </span>
            )}
            <button className={`chip ${m.id === current ? 'active' : ''}`} onClick={() => setMission(m.id)} aria-current={m.id === current} title={m.stage === 3 ? 'Stage 3: breadth (multi-Region, hybrid, storage, data)' : undefined}>
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              {m.title}
              <Stars n={best[m.id]?.stars ?? 0} />
            </button>
          </Fragment>
        ))}
      </nav>
      <div className="top-actions">
        {mode !== 'diff' && (
          <>
            <button className="btn" onClick={() => openTrace(true)} title="Run an ad-hoc packet trace or simulate an API call">
              ⟿ <span className="label">Trace</span>
            </button>
            <button
              className="btn"
              onClick={() => {
                openTrace(false);
                select({ kind: 'iam' });
              }}
              title="Roles, users, KMS keys and SCPs"
            >
              ⚿ <span className="label">IAM</span>
            </button>
          </>
        )}
        <button className="btn" onClick={() => openManual('index')} title="Field Manual">
          ☰ <span className="label">Field Manual</span>
        </button>
        <button className="btn ghost" onClick={doExport} title="Export progress to a JSON file">
          ⇩ <span className="label">Export</span>
        </button>
        <button className="btn ghost" onClick={() => fileRef.current?.click()} title="Import progress from a JSON file">
          ⇧ <span className="label">Import</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) importProgress(await f.text());
          }}
        />
      </div>
    </header>
  );
}
