import { Fragment, useRef, useState } from 'react';
import { ALL_MISSIONS } from '../../content/missions';
import { streak } from '../../engine/mastery/daily';
import { dailyComplete, localDay, Mode, modeOf, useGame } from '../../store/game';
import { Settings } from './Settings';

const MODES: { id: Mode; label: string; short: string }[] = [
  { id: 'build', label: 'Build', short: 'Build' },
  { id: 'incident', label: 'Incidents', short: 'Incidents' },
  { id: 'diff', label: 'Spot the Difference', short: 'Diff' },
  { id: 'refactor', label: 'Refactor', short: 'Refactor' },
];
import { Stars } from './Abbr';

const DIVIDER: Record<number, { label: string; title: string }> = {
  2: { label: 'Stage 2', title: 'Stage 2: investigation' },
  3: { label: 'Breadth', title: 'Stage 3: breadth (multi-Region, hybrid, storage, data)' },
  4: { label: 'Cost', title: 'Stage 4: refactor for cost' },
};

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openDaily = useGame((s) => s.openDaily);
  const openMap = useGame((s) => s.openMap);
  const openExam = useGame((s) => s.openExam);
  const examRunning = useGame((s) => !!s.currentExam());
  const todayDone = useGame((s) => dailyComplete(s.daily[localDay()]));
  const days = useGame((s) => streak(Object.keys(s.daily).filter((d) => dailyComplete(s.daily[d])), localDay()));

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
                {DIVIDER[m.stage]?.label ?? `Stage ${m.stage}`}
              </span>
            )}
            <button className={`chip ${m.id === current ? 'active' : ''}`} onClick={() => setMission(m.id)} aria-current={m.id === current} title={m.stage > 1 ? DIVIDER[m.stage]?.title : undefined}>
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              {m.title}
              <Stars n={best[m.id]?.stars ?? 0} />
            </button>
          </Fragment>
        ))}
      </nav>
      <div className="top-actions">
        <button className={`btn ${todayDone ? '' : 'accent'}`} onClick={() => openDaily(true)} aria-label={days > 0 ? `Today's session, ${days}-day streak` : "Today's session"} title={todayDone ? `Today's session is done. Streak: ${days} day(s)` : "Today's 10-minute session"}>
          ◷ <span className="label">Today</span>
          {days > 0 && <span className="streak" aria-hidden>{days}</span>}
        </button>
        <button className="btn" onClick={() => openMap('index')} aria-label="Concept map" title="Concept map: mastery per exam domain and task">
          ◈ <span className="label">Map</span>
        </button>
        <button className="btn" onClick={() => openExam(true)} aria-label={examRunning ? 'Practice exam (in progress)' : 'Practice exam'} title={examRunning ? 'Practice exam in progress' : 'Practice exam: 65 questions, 130 minutes'}>
          ✎ <span className="label">Exam</span>
          {examRunning && <span className="streak" aria-hidden>…</span>}
        </button>
        {mode !== 'diff' && (
          <>
            <button className="btn" onClick={() => openTrace(true)} title="Run an ad-hoc packet trace or simulate an API call" aria-label="Trace">
              ⟿ <span className="label opt">Trace</span>
            </button>
            <button
              className="btn"
              onClick={() => {
                openTrace(false);
                select({ kind: 'iam' });
              }}
              title="Roles, users, KMS keys and SCPs" aria-label="IAM"
            >
              ⚿ <span className="label opt">IAM</span>
            </button>
          </>
        )}
        <button className="btn" onClick={() => openManual('index')} title="Field Manual" aria-label="Field Manual">
          ☰ <span className="label opt">Field Manual</span>
        </button>
        <button className="btn ghost" onClick={doExport} title="Export progress to a JSON file" aria-label="Export">
          ⇩ <span className="label opt">Export</span>
        </button>
        <button className="btn ghost" onClick={() => fileRef.current?.click()} title="Import progress from a JSON file" aria-label="Import">
          ⇧ <span className="label opt">Import</span>
        </button>
        <button className="btn ghost" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
          ⚙
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
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
