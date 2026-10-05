import { useRef } from 'react';
import { MISSIONS } from '../../content/missions';
import { useGame } from '../../store/game';
import { Stars } from './Abbr';

export function TopBar() {
  const current = useGame((s) => s.currentMissionId);
  const best = useGame((s) => s.best);
  const setMission = useGame((s) => s.setMission);
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
      <nav className="chips" aria-label="Missions">
        {MISSIONS.map((m, i) => (
          <button key={m.id} className={`chip ${m.id === current ? 'active' : ''}`} onClick={() => setMission(m.id)} aria-current={m.id === current}>
            <span className="n">{String(i + 1).padStart(2, '0')}</span>
            {m.title}
            <Stars n={best[m.id]?.stars ?? 0} />
          </button>
        ))}
      </nav>
      <div className="top-actions">
        <button className="btn" onClick={() => openTrace(true)} title="Run an ad-hoc packet trace">
          ⟿ <span className="label">Trace</span>
        </button>
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
