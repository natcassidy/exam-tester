import { Fragment, useState } from 'react';
import { ALL_MISSIONS } from '../../content/missions';
import { streak } from '../../engine/mastery/daily';
import { dailyComplete, localDay, Mode, modeOf, useGame } from '../../store/game';
import { Settings } from './Settings';
import { Icon } from './Icon';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openDaily = useGame((s) => s.openDaily);
  const openMap = useGame((s) => s.openMap);
  const openExam = useGame((s) => s.openExam);
  const examRunning = useGame((s) => !!s.currentExam());
  const todayDone = useGame((s) => dailyComplete(s.daily[localDay()]));
  const days = useGame((s) => streak(Object.keys(s.daily).filter((d) => dailyComplete(s.daily[d])), localDay()));

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
              {best[m.id]?.hardStars === 3 && (
                <span className="tag accent hard-badge" title="Three stars in hard mode">
                  H
                </span>
              )}
            </button>
          </Fragment>
        ))}
      </nav>
      <div className="top-actions">
        <button className={`btn ${todayDone ? '' : 'accent'}`} onClick={() => openDaily(true)} aria-label={days > 0 ? `Today's session, ${days}-day streak` : "Today's session"} title={todayDone ? `Today's session is done. Streak: ${days} day(s)` : "Today's 10-minute session"}>
          <Icon name="clock" /> <span className="label">Today</span>
          {days > 0 && <span className="streak" aria-hidden>{days}</span>}
        </button>
        <button className="btn" onClick={() => openMap('index')} aria-label="Concept map" title="Concept map: mastery per exam domain and task">
          <Icon name="map" /> <span className="label">Map</span>
        </button>
        <button className="btn" onClick={() => openExam(true)} aria-label={examRunning ? 'Practice exam (in progress)' : 'Practice exam'} title={examRunning ? 'Practice exam in progress' : 'Practice exam: 65 questions, 130 minutes'}>
          <Icon name="pencil" /> <span className="label">Exam</span>
          {examRunning && <span className="streak" aria-hidden>…</span>}
        </button>
        <span className="top-sep" aria-hidden />
        {mode !== 'diff' && (
          <>
            <button className="btn" onClick={() => openTrace(true)} title="Run an ad-hoc packet trace or simulate an API call" aria-label="Trace">
              <Icon name="trace" /> <span className="label opt">Trace</span>
            </button>
            <button
              className="btn"
              onClick={() => {
                openTrace(false);
                select({ kind: 'iam' });
              }}
              title="Roles, users, KMS keys and SCPs" aria-label="IAM"
            >
              <Icon name="key" /> <span className="label opt">IAM</span>
            </button>
          </>
        )}
        <button className="btn" onClick={() => openManual('index')} title="Field Manual: every concept, explained" aria-label="Field Manual">
          <Icon name="book" /> <span className="label opt">Manual</span>
        </button>
        <button className="btn ghost" onClick={() => setSettingsOpen(true)} title="Settings, keyboard shortcuts, and export or import your progress" aria-label="Settings">
          <Icon name="gear" />
        </button>
      </div>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
