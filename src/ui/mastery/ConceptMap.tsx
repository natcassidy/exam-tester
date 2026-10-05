import { useMemo } from 'react';
import type { ConceptId } from '../../engine/model';
import { DOMAIN_LABELS } from '../../engine/model';
import { masteryAll, MasteryLevel } from '../../engine/mastery/mastery';
import { srsCards, isDue, MAX_BOX } from '../../engine/mastery/srs';
import { DOMAIN_ORDER, DOMAIN_WEIGHTS } from '../../engine/mastery/exam';
import { CONCEPTS, CONCEPT_BY_ID, TASKS } from '../../content/concepts';
import { ALL_MISSIONS } from '../../content/missions';
import { QUESTIONS } from '../../content/questions';
import { modeOf, nowIso, useGame } from '../../store/game';
import { evidenceLabel, fmtDate } from './labels';

export const LEVEL_LABEL: Record<MasteryLevel, string> = { new: 'Not started', weak: 'Weak', learning: 'Learning', strong: 'Strong' };

export function useMastery() {
  const evidence = useGame((s) => s.conceptEvidence);
  return useMemo(() => {
    const now = nowIso();
    const ids = CONCEPTS.map((c) => c.id);
    return { now, mastery: masteryAll(evidence, ids, now), cards: srsCards(evidence, ids), evidence };
  }, [evidence]);
}

function ConceptDetail({ id }: { id: ConceptId }) {
  const { mastery, cards, evidence, now } = useMastery();
  const openMap = useGame((s) => s.openMap);
  const openManual = useGame((s) => s.openManual);
  const practice = useGame((s) => s.practiceConcept);
  const setMission = useGame((s) => s.setMission);
  const c = CONCEPT_BY_ID[id];
  const m = mastery[id];
  const card = cards[id];
  const history = evidence.filter((e) => e.conceptId === id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);
  const missions = ALL_MISSIONS.filter((x) => x.concepts.includes(id));
  const task = TASKS.find((t) => t.id === c.task);
  const nQ = QUESTIONS.filter((q) => q.concepts.includes(id)).length;
  return (
    <div className="concept-detail">
      <button className="btn ghost small" onClick={() => openMap('index')}>
        ← All concepts
      </button>
      <h3 style={{ marginTop: 8 }}>{c.title}</h3>
      <p className="hint">
        {DOMAIN_LABELS[c.domain]} · Task {c.task}: {task?.title}
      </p>
      <div className="detail-lines">
        <div>
          <span className="k">Mastery</span>
          <span className={`lvl-${m.level}`}>{m.count ? `${Math.round(m.score * 100)}% · ${LEVEL_LABEL[m.level]}` : LEVEL_LABEL.new}</span>
        </div>
        <div>
          <span className="k">Review box</span>
          <span>{card.box ? `${card.box} of ${MAX_BOX}` : '—'}</span>
        </div>
        <div>
          <span className="k">Next review</span>
          <span>{card.dueAt ? (isDue(card, now) ? 'Due now' : fmtDate(card.dueAt)) : 'After your first answer'}</span>
        </div>
      </div>
      <div className="actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        <button className="btn primary small" onClick={() => practice(id)} disabled={!nQ}>
          Practice this ({Math.min(nQ, 5)} questions)
        </button>
        <button className="btn small" onClick={() => openManual(id)}>
          ☰ Field Manual
        </button>
      </div>
      {missions.length > 0 && (
        <div className="section">
          <h4>Where it's taught</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {missions.map((x) => (
              <button
                key={x.id}
                className="btn ghost small"
                onClick={() => {
                  setMission(x.id);
                  openMap(null);
                }}
              >
                {modeOf(x) === 'build' ? 'Build' : modeOf(x) === 'incident' ? 'Incident' : modeOf(x) === 'diff' ? 'Diff' : 'Refactor'} · {x.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="section">
        <h4>Evidence</h4>
        {history.length === 0 ? (
          <p className="hint">Nothing yet. Simulations, questions, incidents, Spot the Difference rounds, Defend rounds and exams all add evidence.</p>
        ) : (
          <ul className="evidence">
            {history.map((e, i) => {
              const l = evidenceLabel(e);
              return (
                <li key={i}>
                  <span className={`mark ${e.correct ? 'met' : 'missed'}`} aria-label={e.correct ? 'correct' : 'incorrect'}>
                    {e.correct ? '✓' : '✗'}
                  </span>
                  <span className="hint">{fmtDate(e.at)}</span>
                  <span>
                    <b>{l.kind}</b>
                    {e.weight !== 1 && <span className="hint"> (×{e.weight})</span>} · {l.what}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ConceptMap() {
  const open = useGame((s) => s.mapOpen);
  const openMap = useGame((s) => s.openMap);
  const { mastery, cards, now } = useMastery();
  if (!open) return null;
  const selected = open !== 'index' ? open : null;
  const close = () => openMap(null);
  const dueCount = Object.values(cards).filter((c) => isDue(c, now)).length;
  return (
    <div className="modal-back" onClick={close} role="dialog" aria-modal aria-label="Concept map">
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Concept map</h2>
          <span className="hint">
            {dueCount} concept{dueCount === 1 ? '' : 's'} due for review
          </span>
          <button className="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={`map-body ${selected ? 'has-detail' : ''}`}>
          <div className="map-grid">
            {DOMAIN_ORDER.map((d) => {
              const cs = CONCEPTS.filter((c) => c.domain === d);
              const seen = cs.filter((c) => mastery[c.id].count);
              const avg = cs.reduce((s, c) => s + (mastery[c.id].count ? mastery[c.id].score : 0), 0) / cs.length;
              return (
                <section key={d} className="map-domain" aria-label={DOMAIN_LABELS[d]}>
                  <header>
                    <h3>{DOMAIN_LABELS[d]}</h3>
                    <span className="hint">
                      {Math.round(DOMAIN_WEIGHTS[d] * 100)}% of the exam · {seen.length}/{cs.length} started
                    </span>
                    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(avg * 100)} aria-label="Domain readiness">
                      <span style={{ width: `${Math.round(avg * 100)}%` }} />
                    </div>
                  </header>
                  {TASKS.filter((t) => t.domain === d).map((t) => {
                    const tc = cs.filter((c) => c.task === t.id);
                    if (!tc.length) return null;
                    return (
                      <div key={t.id} className="map-task">
                        <h4>
                          <span className="mono">{t.id}</span> {t.title}
                        </h4>
                        <div className="map-nodes">
                          {tc.map((c) => {
                            const m = mastery[c.id];
                            const due = isDue(cards[c.id], now);
                            return (
                              <button key={c.id} className={`map-node lvl-${m.level} ${selected === c.id ? 'on' : ''}`} onClick={() => openMap(c.id)} aria-pressed={selected === c.id} title={`${LEVEL_LABEL[m.level]}${m.count ? ` · ${Math.round(m.score * 100)}%` : ''}${due ? ' · due' : ''}`}>
                                <span className="dot" aria-hidden />
                                <span>{c.title}</span>
                                {due && <span className="due">due</span>}
                                <span className="sr-only">
                                  {LEVEL_LABEL[m.level]}
                                  {m.count ? `, ${Math.round(m.score * 100)}%` : ''}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
          {selected && CONCEPT_BY_ID[selected] && (
            <aside className="map-detail">
              <ConceptDetail id={selected} />
            </aside>
          )}
        </div>
        <div className="map-legend">
          {(['new', 'weak', 'learning', 'strong'] as MasteryLevel[]).map((l) => (
            <span key={l} className={`map-node lvl-${l} legend`}>
              <span className="dot" aria-hidden />
              {LEVEL_LABEL[l]}
            </span>
          ))}
          <span className="hint">Mastery = weighted recent accuracy (older evidence fades; Defend rounds count half).</span>
        </div>
      </div>
    </div>
  );
}
