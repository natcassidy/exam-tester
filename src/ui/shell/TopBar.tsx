import { Fragment, useEffect, useRef, useState } from 'react';
import { COURSE, COURSE_SECTIONS } from '../../content/course';
import { streak } from '../../engine/mastery/daily';
import { dailyComplete, localDay, modeOf, useGame } from '../../store/game';
import { Settings } from './Settings';
import { Icon } from './Icon';
import { Stars } from './Abbr';
import { COURSE_KIND, DIVIDER, missionsOf, MODES } from './missionGroups';

export function TopBar() {
  const current = useGame((s) => s.currentMissionId);
  const best = useGame((s) => s.best);
  const setMission = useGame((s) => s.setMission);
  const setMode = useGame((s) => s.setMode);
  const select = useGame((s) => s.select);
  const mission = useGame((s) => s.mission());
  const mode = modeOf(mission);
  // Course Labs show one section at a time; the mission index lists every section.
  const missions = mode === 'course' ? COURSE.filter((m) => m.course!.section === mission.course?.section) : missionsOf(mode);
  const all = missionsOf(mode);
  const allDone = all.filter((m) => (best[m.id]?.stars ?? 0) === 3).length;
  const openIndex = useGame((s) => s.openIndex);
  const section = COURSE_SECTIONS.find((s) => s.n === mission.course?.section);
  // Neighbouring sections that have labs, for the previous / next section buttons.
  const labSections = COURSE_SECTIONS.filter((s) => COURSE.some((m) => m.course!.section === s.n));
  const sectionAt = labSections.findIndex((s) => s.n === section?.n);
  const goSection = (n: number | undefined) => {
    const first = n === undefined ? undefined : COURSE.find((m) => m.course!.section === n);
    if (first) setMission(first.id);
  };
  const openManual = useGame((s) => s.openManual);
  const openTrace = useGame((s) => s.openTrace);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openDaily = useGame((s) => s.openDaily);
  const openMap = useGame((s) => s.openMap);
  const openExam = useGame((s) => s.openExam);
  const examRunning = useGame((s) => !!s.currentExam());
  const todayDone = useGame((s) => dailyComplete(s.daily[localDay()]));
  const days = useGame((s) => streak(Object.keys(s.daily).filter((d) => dailyComplete(s.daily[d])), localDay()));

  // Keep the current mission's chip in view when the row scrolls.
  const chips = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = chips.current;
    const chip = nav?.querySelector<HTMLElement>('.chip.active');
    const lead = nav?.querySelector<HTMLElement>('.chips-lead');
    if (!nav || !chip) return;
    const left = chip.offsetLeft - (lead?.offsetWidth ?? 0) - 12;
    if (left < nav.scrollLeft || chip.offsetLeft + chip.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: Math.max(0, left) });
  }, [current]);

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
      <nav className="chips" aria-label="Missions" ref={chips}>
        <span className="chips-lead">
          <button className="chip index-btn" onClick={() => openIndex(mode)} title="Every mission in every mode, grouped, with your progress" aria-haspopup="dialog">
            <Icon name="list" /> All <span className="n">{allDone}/{all.length}</span>
          </button>
          {mode === 'course' && section && (
            <span className="section-nav">
              <button className="btn ghost small" onClick={() => goSection(labSections[sectionAt - 1]?.n)} disabled={sectionAt <= 0} aria-label="Previous course section" title="Previous section">
                <Icon name="chevronLeft" />
              </button>
              <button className="chip section-pick" onClick={() => openIndex('course')} aria-label={`Course section ${section.n}: ${section.title}. Show all sections`} title="Show every course section and its labs">
                <span className="n">§{section.n}</span> {section.title}
              </button>
              <button className="btn ghost small" onClick={() => goSection(labSections[sectionAt + 1]?.n)} disabled={sectionAt < 0 || sectionAt >= labSections.length - 1} aria-label="Next course section" title="Next section">
                <Icon name="chevronRight" />
              </button>
            </span>
          )}
        </span>
        {missions.map((m, i) => (
          <Fragment key={m.id}>
            {mode !== 'course' && i > 0 && m.stage !== missions[i - 1].stage && (
              <span className="chip-divider" aria-hidden>
                {DIVIDER[m.stage]?.label ?? `Stage ${m.stage}`}
              </span>
            )}
            <button className={`chip ${m.id === current ? 'active' : ''}`} onClick={() => setMission(m.id)} aria-current={m.id === current} title={m.course ? COURSE_KIND[m.course.kind] : m.stage > 1 ? DIVIDER[m.stage]?.title : undefined}>
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              {m.course && <span className={`tag kind-${m.course.kind}`}>{m.course.kind}</span>}
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
