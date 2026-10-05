import { useState } from 'react';
import { streak } from '../../engine/mastery/daily';
import { dailyComplete, localDay, Mode, modeOf, useGame } from '../../store/game';
import { MissionPicker } from './MissionPicker';
import { Settings } from './Settings';

const MODES: { id: Mode; label: string; short: string }[] = [
  { id: 'build', label: 'Build', short: 'Build' },
  { id: 'incident', label: 'Incidents', short: 'Incidents' },
  { id: 'diff', label: 'Spot the Difference', short: 'Diff' },
  { id: 'refactor', label: 'Refactor', short: 'Refactor' },
];

/** Where you are (mode and mission) on the left; study tools and settings on the right. */
export function TopBar() {
  const setMode = useGame((s) => s.setMode);
  const mission = useGame((s) => s.mission());
  const mode = modeOf(mission);
  const openManual = useGame((s) => s.openManual);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openDaily = useGame((s) => s.openDaily);
  const openMap = useGame((s) => s.openMap);
  const openExam = useGame((s) => s.openExam);
  const examRunning = useGame((s) => !!s.currentExam());
  const todayDone = useGame((s) => dailyComplete(s.daily[localDay()]));
  const days = useGame((s) => streak(Object.keys(s.daily).filter((d) => dailyComplete(s.daily[d])), localDay()));

  return (
    <header className="topbar">
      <div className="logo" aria-label="Blast Radius">
        <span className="logo-full">
          BLAST<b>/</b>RADIUS
        </span>
        <span className="logo-short" aria-hidden>
          B<b>/</b>R
        </span>
      </div>
      <div className="where">
        <div className="modes" role="tablist" aria-label="Game mode">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)} title={m.label}>
              <span className="long">{m.label}</span>
              <span className="short">{m.short}</span>
            </button>
          ))}
        </div>
        <MissionPicker />
      </div>
      <nav className="top-actions" aria-label="Study and settings">
        <button
          className="btn"
          onClick={() => openDaily(true)}
          aria-label={days > 0 ? `Today's session, ${days}-day streak` : "Today's session"}
          title={todayDone ? `Today's session is done. Streak: ${days} day(s)` : "Today's 10-minute review session"}
        >
          <span className="ic" aria-hidden>◷</span> <span className="label">Today</span>
          {!todayDone && <span className="due-dot" aria-hidden />}
          {days > 0 && <span className="streak" aria-hidden>{days}</span>}
        </button>
        <button className="btn" onClick={() => openMap('index')} aria-label="Concept map" title="Concept map: mastery per exam domain and task">
          <span className="ic" aria-hidden>◈</span> <span className="label">Map</span>
        </button>
        <button className="btn" onClick={() => openExam(true)} aria-label={examRunning ? 'Practice exam (in progress)' : 'Practice exam'} title={examRunning ? 'Practice exam in progress' : 'Practice exam: 65 questions, 130 minutes'}>
          <span className="ic" aria-hidden>✎</span> <span className="label">Exam</span>
          {examRunning && <span className="streak" aria-hidden>…</span>}
        </button>
        <span className="top-sep" aria-hidden />
        <button className="btn" onClick={() => openManual('index')} title="Field Manual: every concept the game tests" aria-label="Field Manual">
          <span className="ic" aria-hidden>☰</span> <span className="label">Manual</span>
        </button>
        <button className="btn ghost" onClick={() => setSettingsOpen(true)} title="Settings, export and import progress" aria-label="Settings">
          ⚙
        </button>
      </nav>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
