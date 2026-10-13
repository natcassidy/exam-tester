import { useEffect, useMemo, useState } from 'react';
import type { Board as BoardT } from '../../engine/model';
import type { RefDifference } from '../../engine/assist/compare';
import { buildDebrief, type DecisionReview } from '../../engine/assist/debrief';
import { hasHardMode, missionPalette } from '../../engine/palette';
import { scoreResults } from '../../engine/scoring';
import { SERVICES } from '../../content/services';
import { manualTitle } from '../../content/manual';
import { describeSelection, selectionFor, type Selection, useGame } from '../../store/game';
import { Board } from '../board/Board';
import { BoardViewContext } from '../board/context';
import { describeObject } from '../diff/DiffView';
import { Abbr, Stars } from '../shell/Abbr';
import { Icon } from '../shell/Icon';

type Tab = 'decisions' | 'boards' | 'other';

function DiffLine({ d }: { d: RefDifference }) {
  const board = useGame((s) => s.board());
  const select = useGame((s) => s.select);
  const close = useGame((s) => s.openDebrief);
  const target = d.playerTarget ? selectionFor(board, d.playerTarget) : null;
  return (
    <li>
      <span>{d.text}</span>
      {target && (
        <button
          className="btn small ghost"
          onClick={() => {
            select(target);
            close(false);
          }}
        >
          Open on my board →
        </button>
      )}
    </li>
  );
}

const STATUS = {
  covered: { mark: '✓', tag: 'pass', label: 'Your design handles this' },
  missed: { mark: '✗', tag: 'fail', label: 'Your design misses this' },
  same: { mark: '=', tag: 'muted', label: 'Same as the reference' },
  untested: { mark: '○', tag: 'muted', label: 'Not run yet' },
} as const;

function DecisionCard({ r, n }: { r: DecisionReview; n: number }) {
  const openManual = useGame((s) => s.openManual);
  const st = STATUS[r.status];
  const d = r.decision;
  return (
    <article className={`decision ${r.status}`}>
      <div className="decision-head">
        <span className="decision-n mono">{String(n).padStart(2, '0')}</span>
        <h3>{d.title}</h3>
        <span className={`tag ${st.tag}`}>
          {st.mark} {st.label}
        </span>
      </div>
      <dl>
        <dt>The reference</dt>
        <dd>{d.choice}</dd>
        <dt>Why it matters</dt>
        <dd>{d.why}</dd>
        {r.failing.length > 0 && (
          <>
            <dt>{r.status === 'same' ? 'Still failing' : 'Fails on your board'}</dt>
            <dd>
              {r.failing.join(' · ')}
              {r.status === 'same' && <span className="hint"> · you match the reference here; another decision explains the failure</span>}
            </dd>
          </>
        )}
        {r.diffs.length > 0 && (
          <>
            <dt>{r.status === 'covered' ? 'You got there differently' : 'Where yours differs'}</dt>
            <dd>
              <ul className="decision-diffs">
                {r.diffs.map((x, i) => (
                  <DiffLine key={i} d={x} />
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      {!!d.manual?.length && (
        <div className="decision-actions">
          {d.manual.map((id) => (
            <button key={id} className="btn small ghost" onClick={() => openManual(id)}>
              ☰ {manualTitle(id)}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function SideBoard({ title, sub, board, marks, legend }: { title: string; sub: string; board: BoardT; marks: Record<string, 'extra' | 'missing' | 'changed'>; legend: [string, string][] }) {
  const [sel, setSel] = useState<Selection | null>(null);
  const view = useMemo(() => ({ board, readOnly: true, idPrefix: `${title}:`, selection: sel, select: setSel, marks }), [board, sel, marks, title]);
  return (
    <section className="diff-side" aria-label={title}>
      <div className="diff-side-head">
        <b>{title}</b>
        <span className="hint">{sub}</span>
      </div>
      <div className="review-legend">
        {legend.map(([cls, text]) => (
          <span key={cls}>
            <i className={`swatch ${cls}`} aria-hidden /> {text}
          </span>
        ))}
      </div>
      <div className="diff-board">
        <BoardViewContext.Provider value={view}>
          <Board />
        </BoardViewContext.Provider>
      </div>
      {sel ? (
        <div className="reference-inspect">
          <h4>{describeSelection(board, sel)}</h4>
          <table className="compare">
            <tbody>
              {describeObject(board, sel).map(([k, v]) => (
                <tr key={k}>
                  <td className="hint">{k}</td>
                  <td className="mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hint" style={{ padding: '6px 10px' }}>
          Click anything to see its settings.
        </p>
      )}
    </section>
  );
}

/**
 * End-of-mission solution review: the reference design's key decisions and why they matter, whether
 * the player's design covers each one, both boards side by side with the differences outlined, and
 * why the services the reference skipped were the wrong tools.
 */
export function SolutionReview() {
  const open = useGame((s) => s.debriefOpen);
  const close = useGame((s) => s.openDebrief);
  const mission = useGame((s) => s.mission());
  const board = useGame((s) => s.board());
  const results = useGame((s) => s.results[s.currentMissionId]);
  const stale = useGame((s) => !!s.results[s.currentMissionId] && s.resultsBoard[s.currentMissionId] !== s.board());
  const refactor = useGame((s) => s.refactorScores[s.currentMissionId]);
  const difficulty = useGame((s) => s.settings.difficulty ?? 'easy');
  const runSim = useGame((s) => s.runSim);
  const [tab, setTab] = useState<Tab>('decisions');
  useEffect(() => setTab('decisions'), [mission.id, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  const db = useMemo(() => (open ? buildDebrief(mission, board, results) : null), [open, mission, board, results]);
  if (!open || !db || mission.incident || mission.diff) return null;

  const score = results ? (refactor ? { stars: refactor.stars, points: refactor.points } : scoreResults(mission.events, results)) : null;
  const covered = db.decisions.filter((d) => d.status === 'covered').length;
  const missed = db.decisions.filter((d) => d.status === 'missed').length;
  const usedTypes = new Set([...Object.values(board.components).map((c) => c.type), ...Object.values(mission.reference.components).map((c) => c.type)]);
  // Services on offer that neither board uses: in hard mode, the distractors the player rightly skipped.
  const skipped = missionPalette(mission, difficulty).filter((t) => !usedTypes.has(t) && mission.whyNot?.[t]);
  const otherCount = db.other.length;

  return (
    <div className="modal-back" onClick={() => close(false)} role="dialog" aria-modal aria-label="Solution review">
      <div className="modal wide review" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Solution review · {mission.title}</h2>
          {score && (
            <span className="score">
              <Stars n={score.stars} /> <span className="hint">{score.points} pts</span>
            </span>
          )}
          {hasHardMode(mission) && <span className={`tag ${difficulty === 'hard' ? 'accent' : 'muted'}`}>{difficulty === 'hard' ? 'HARD' : 'EASY'}</span>}
          <button className="btn ghost small" onClick={() => close(false)} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="review-summary">
          <p>
            {db.allPass
              ? `Every check passed. Your design covers ${covered} of ${db.decisions.length} key decisions the way the checks measure them. Below is how the reference solved each one and why it matters, including where you took a different route.`
              : results
                ? `${missed} of ${db.decisions.length} key decisions need work: the ones marked ✗. Each says what the reference does, why it matters and exactly where your board differs. Decisions marked = already match the reference.`
                : 'Run the simulation to see which decisions your design covers.'}
          </p>
          {stale && (
            <p className="hint">
              Your board changed since the last run, so the ✓ and ✗ marks may be out of date.{' '}
              <button className="btn small" onClick={runSim}>
                Run again
              </button>
            </p>
          )}
          <p className="hint">The reference is one design that passes every check, not the only one. If yours passes with a different setup, that's a valid answer.</p>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'decisions'} className={tab === 'decisions' ? 'on' : ''} onClick={() => setTab('decisions')}>
            Key decisions ({db.decisions.length})
          </button>
          <button role="tab" aria-selected={tab === 'boards'} className={tab === 'boards' ? 'on' : ''} onClick={() => setTab('boards')}>
            Side by side
          </button>
          <button role="tab" aria-selected={tab === 'other'} className={tab === 'other' ? 'on' : ''} onClick={() => setTab('other')}>
            Other ({otherCount})
          </button>
        </div>
        {tab === 'decisions' && (
          <div className="review-body">
            {db.decisions.map((r, i) => (
              <DecisionCard key={i} r={r} n={i + 1} />
            ))}
            {db.extras.length > 0 && (
              <section className="review-section">
                <h4>Services you added that the reference doesn't use</h4>
                <ul className="why-not">
                  {db.extras.map((x) => (
                    <li key={x.type}>
                      <Abbr type={x.type} />
                      <div>
                        <b>
                          {SERVICES[x.type].name} <span className="hint">({x.names.join(', ')})</span>
                        </b>
                        <div>{x.note ?? "The reference design doesn't need one. If your design passes with it, check what it adds to the bill."}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {skipped.length > 0 && (
              <details className="review-section">
                <summary>
                  <b>Services on offer that this design doesn't need ({skipped.length})</b>
                </summary>
                <ul className="why-not">
                  {skipped.map((t) => (
                    <li key={t}>
                      <Abbr type={t} />
                      <div>
                        <b>{SERVICES[t].name}</b>
                        <div>{mission.whyNot![t]}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {tab === 'boards' && (
          <div className="diff-boards review-boards">
            <SideBoard title="Your design" sub={results ? `${results.filter((r) => r.status === 'pass').length}/${results.length} checks passed` : 'not run yet'} board={board} marks={db.playerMarks} legend={[['mark-extra', 'not in the reference'], ['mark-changed', 'set up differently']]} />
            <SideBoard title="Reference design" sub="passes every check" board={mission.reference} marks={db.refMarks} legend={[['mark-missing', 'missing from yours'], ['mark-changed', 'set up differently']]} />
          </div>
        )}
        {tab === 'other' && (
          <div className="review-body">
            {otherCount ? (
              <>
                <p className="hint">Differences that none of the key decisions above covers: routes, security group rules and settings that don't change the outcome on their own.</p>
                <ul className="decision-diffs">
                  {db.other.map((d, i) => (
                    <DiffLine key={i} d={d} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="hint">Nothing else differs from the reference.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
