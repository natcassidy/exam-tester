// Mission index: every mission, incident, Diff round, refactor and Course Lab on one page, grouped
// by stage or course section, with progress, so any of them is one click away.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Mission } from '../../engine/model';
import { ALL_MISSIONS } from '../../content/missions';
import { COURSE_SECTIONS } from '../../content/course';
import { Mode, modeOf, useGame } from '../../store/game';
import { Stars } from './Abbr';
import { COURSE_KIND, groupsOf, MissionGroup, missionsOf, MODES, modeLabel } from './missionGroups';

type Best = ReturnType<typeof useGame.getState>['best'];

const done = (best: Best, ms: Mission[]) => ms.filter((m) => (best[m.id]?.stars ?? 0) === 3).length;

function matches(m: Mission, q: string): boolean {
  const section = m.course ? COURSE_SECTIONS.find((s) => s.n === m.course!.section)?.title ?? '' : '';
  return [m.title, m.client, m.users, section, m.course?.kind ?? ''].some((t) => t.toLowerCase().includes(q));
}

/** A mission's number in its mode, as on the top bar's chips; Course Labs are numbered within their section. */
function numberIn(m: Mission): string {
  if (m.course) return `${m.course.section}.${missionsOf('course').filter((x) => x.course!.section === m.course!.section).indexOf(m) + 1}`;
  return String(missionsOf(modeOf(m)).indexOf(m) + 1).padStart(2, '0');
}

function MissionRow({ m, n, current, best, onPick }: { m: Mission; n: string; current: boolean; best: Best; onPick: (id: string) => void }) {
  const b = best[m.id];
  return (
    <li>
      <button className={`index-row ${current ? 'on' : ''}`} onClick={() => onPick(m.id)} aria-current={current || undefined} data-current={current || undefined}>
        <span className="n">{n}</span>
        <span className="what">
          <span className="title">
            {m.course && (
              <span className={`tag kind-${m.course.kind}`} title={COURSE_KIND[m.course.kind]}>
                {m.course.kind}
              </span>
            )}
            {m.title}
          </span>
          <span className="client">{m.client}</span>
        </span>
        <span className="score">
          {b?.hardStars === 3 && (
            <span className="tag accent hard-badge" title="Three stars in hard mode">
              H
            </span>
          )}
          {b ? <Stars n={b.stars} /> : <span className="hint">New</span>}
        </span>
      </button>
    </li>
  );
}

function Group({ g, best, current, onPick }: { g: MissionGroup; best: Best; current: string; onPick: (id: string) => void }) {
  if (!g.missions.length) {
    return (
      <section className="index-group empty" aria-label={g.title}>
        <header>
          <h3>{g.title}</h3>
          <span className="hint">No labs</span>
        </header>
        {g.note && <p className="hint">{g.note}</p>}
      </section>
    );
  }
  const d = done(best, g.missions);
  return (
    <section className="index-group" aria-label={g.title}>
      <header>
        <h3>{g.title}</h3>
        <span className={`hint ${d === g.missions.length ? 'all-done' : ''}`}>
          {d}/{g.missions.length} done
        </span>
      </header>
      <ul>
        {g.missions.map((m) => (
          <MissionRow key={m.id} m={m} n={numberIn(m)} current={m.id === current} best={best} onPick={onPick} />
        ))}
      </ul>
    </section>
  );
}

export function MissionIndex() {
  const open = useGame((s) => s.indexOpen);
  if (!open) return null;
  return <IndexDialog initial={open} />;
}

function IndexDialog({ initial }: { initial: Mode }) {
  const openIndex = useGame((s) => s.openIndex);
  const setMission = useGame((s) => s.setMission);
  const current = useGame((s) => s.currentMissionId);
  const best = useGame((s) => s.best);
  const [mode, setMode] = useState<Mode>(initial);
  const [query, setQuery] = useState('');
  const [hideEmpty, setHideEmpty] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const close = () => openIndex(null);
  const pick = (id: string) => {
    setMission(id);
    close();
  };
  const q = query.trim().toLowerCase();

  // Open on the current mission.
  useEffect(() => {
    const el = body.current;
    const row = el?.querySelector<HTMLElement>('[data-current]');
    if (el && row) el.scrollTop = row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - el.clientHeight / 3;
  }, [mode]);

  const groups = useMemo(() => groupsOf(mode), [mode]);
  const results = useMemo(() => (q ? ALL_MISSIONS.filter((m) => matches(m, q)) : []), [q]);

  const all = missionsOf(mode);
  return (
    <div className="modal-back" onClick={close} role="dialog" aria-modal aria-label="All missions">
      <div className="modal wide index-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>All missions</h2>
          <input className="index-search" type="search" placeholder="Search titles, clients, sections…" aria-label="Search missions" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <button className="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        {!q && (
          <div className="index-tabs" role="tablist" aria-label="Mission type">
            {MODES.map((x) => {
              const ms = missionsOf(x.id);
              return (
                <button key={x.id} role="tab" aria-selected={mode === x.id} className={mode === x.id ? 'on' : ''} onClick={() => setMode(x.id)}>
                  {x.label}
                  <span className="count">
                    {done(best, ms)}/{ms.length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="index-body" ref={body}>
          {q ? (
            results.length ? (
              <div className="index-grid">
                {MODES.map((x) => {
                  const ms = results.filter((m) => modeOf(m) === x.id);
                  if (!ms.length) return null;
                  return (
                    <section key={x.id} className="index-group" aria-label={x.label}>
                      <header>
                        <h3>{x.label}</h3>
                        <span className="hint">
                          {ms.length} match{ms.length === 1 ? '' : 'es'}
                        </span>
                      </header>
                      <ul>
                        {ms.map((m) => (
                          <MissionRow key={m.id} m={m} n={numberIn(m)} current={m.id === current} best={best} onPick={pick} />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ) : (
              <p className="hint index-none">Nothing matches “{query.trim()}”.</p>
            )
          ) : (
            <>
              <div className="index-summary">
                <span>
                  <b>{modeLabel(mode)}</b>: {done(best, all)} of {all.length} {MODES.find((x) => x.id === mode)!.noun} at three stars
                </span>
                <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={all.length} aria-valuenow={done(best, all)} aria-label={`${modeLabel(mode)} progress`}>
                  <span style={{ width: `${Math.round((done(best, all) / all.length) * 100)}%` }} />
                </div>
                {mode === 'course' && (
                  <label className="hint index-toggle">
                    <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide sections without labs
                  </label>
                )}
              </div>
              <div className="index-grid">
                {groups
                  .filter((g) => !hideEmpty || g.missions.length)
                  .map((g) => (
                    <Group key={g.key} g={g} best={best} current={current} onPick={pick} />
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
