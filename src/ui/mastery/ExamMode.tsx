import { useEffect, useMemo, useState } from 'react';
import { DOMAIN_LABELS, Domain } from '../../engine/model';
import { displayOptions, DOMAIN_ORDER, DOMAIN_WEIGHTS, letter, EXAM_MINUTES, EXAM_QUESTIONS, isCorrect, PASS_SCALED } from '../../engine/mastery/exam';
import { manualTitle } from '../../content/manual';
import { QUESTION_BY_ID } from '../../content/questions';
import type { ExamAttempt } from '../../store/schema';
import { useGame } from '../../store/game';
import { fmtDate } from './labels';

const LIMIT_MS = EXAM_MINUTES * 60_000;

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function StartScreen({ onStart }: { onStart: () => void }) {
  const all = useGame((s) => s.exams);
  const exams = useMemo(() => all.filter((e) => e.finishedAt), [all]);
  return (
    <div>
      <p className="q-stem">
        {EXAM_QUESTIONS} questions in {EXAM_MINUTES} minutes, drawn from the question bank with the SAA-C03 domain weights. Nothing is explained until you submit, as on the real exam. You can flag questions and come back to them.
      </p>
      <ul className="exam-weights">
        {DOMAIN_ORDER.map((d) => (
          <li key={d}>
            {DOMAIN_LABELS[d]} <span className="hint">{Math.round(DOMAIN_WEIGHTS[d] * 100)}%</span>
          </li>
        ))}
      </ul>
      <p className="hint">The timer keeps running if you close this window; your answers are saved as you go.</p>
      <button className="btn primary" onClick={onStart} autoFocus>
        Start the practice exam
      </button>
      {exams.length > 0 && (
        <div className="section">
          <h4>Past attempts</h4>
          <ul className="exam-history">
            {[...exams].reverse().map((e) => (
              <li key={e.id}>
                <span>{fmtDate(e.finishedAt!)}</span>
                <b>{e.score?.scaled}</b>
                <span className={`tag ${e.score?.pass ? 'pass' : 'fail'}`}>{e.score?.pass ? 'pass' : 'below 720'}</span>
                <span className="hint">
                  {e.score?.correct}/{e.score?.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Results({ attempt, onReview }: { attempt: ExamAttempt; onReview: () => void }) {
  const sc = attempt.score!;
  return (
    <div>
      <div className="exam-score">
        <div className="big">{sc.scaled}</div>
        <div>
          <span className={`tag ${sc.pass ? 'pass' : 'fail'}`}>{sc.pass ? 'Pass' : 'Not yet'}</span>
          <p className="hint">
            {sc.correct} of {sc.total} correct · pass mark {PASS_SCALED}
          </p>
        </div>
      </div>
      <p className="hint">
        This is an estimate. AWS reports a scaled score from 100 to 1000 and doesn't publish how it converts raw answers, so this maps your share of correct answers linearly onto that range.
      </p>
      <table className="exam-domains">
        <thead>
          <tr>
            <th>Domain</th>
            <th>Correct</th>
            <th aria-label="Share" />
          </tr>
        </thead>
        <tbody>
          {DOMAIN_ORDER.map((d) => {
            const r = sc.byDomain[d as Domain] ?? { correct: 0, total: 0 };
            const pct = r.total ? r.correct / r.total : 0;
            return (
              <tr key={d}>
                <td>{DOMAIN_LABELS[d]}</td>
                <td>
                  {r.correct}/{r.total}
                </td>
                <td>
                  <span className="meter" aria-label={`${Math.round(pct * 100)}%`}>
                    <span style={{ width: `${pct * 100}%` }} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">Every answer was added to your concept map as evidence.</p>
      <button className="btn primary" onClick={onReview}>
        Review the answers
      </button>
    </div>
  );
}

function ReviewAnswers({ attempt }: { attempt: ExamAttempt }) {
  const openManual = useGame((s) => s.openManual);
  const [onlyWrong, setOnlyWrong] = useState(true);
  const ids = attempt.questionIds.filter((id) => !onlyWrong || !isCorrect(QUESTION_BY_ID[id], attempt.answers[id]));
  return (
    <div>
      <label className="check" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input type="checkbox" checked={onlyWrong} onChange={(e) => setOnlyWrong(e.target.checked)} />
        <span>Only the ones I missed</span>
      </label>
      {ids.length === 0 && <p className="hint">Nothing missed.</p>}
      {ids.map((id) => {
        const q = QUESTION_BY_ID[id];
        if (!q) return null;
        const chosen = attempt.answers[id] ?? [];
        return (
          <div key={id} className="exam-review">
            <p className="q-stem">
              <span className="mono">{attempt.questionIds.indexOf(id) + 1}.</span> {q.stem}
            </p>
            {displayOptions(q).map((o, i) => {
              const right = q.correct.includes(o.id);
              const picked = chosen.includes(o.id);
              return (
                <div key={o.id} className={`q-opt static ${right ? 'right' : picked ? 'wrong' : ''}`}>
                  <span className="mono">{letter(i)}.</span>
                  <span>
                    {o.text}
                    {picked && <span className="hint"> (your answer)</span>}
                  </span>
                  <span className="why">
                    {right ? '✓ ' : '✗ '}
                    {o.why}
                  </span>
                </div>
              );
            })}
            {q.concepts.map((c) => (
              <button key={c} className="btn ghost small" onClick={() => openManual(c)}>
                ☰ {manualTitle(c)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function InProgress({ attempt, now, onFinished }: { attempt: ExamAttempt; now: number; onFinished: () => void }) {
  const answer = useGame((s) => s.answerExam);
  const toggleFlag = useGame((s) => s.toggleFlag);
  const finish = useGame((s) => s.finishExam);
  const [idx, setIdx] = useState(() => Math.max(0, attempt.questionIds.findIndex((id) => !attempt.answers[id])));
  const [overview, setOverview] = useState(false);
  const left = LIMIT_MS - (now - new Date(attempt.startedAt).getTime());
  const total = attempt.questionIds.length;
  const answered = attempt.questionIds.filter((id) => attempt.answers[id]?.length).length;
  const id = attempt.questionIds[idx];
  const q = QUESTION_BY_ID[id];
  const chosen = attempt.answers[id] ?? [];
  const multi = q ? q.correct.length > 1 : false;
  const flagged = attempt.flagged.includes(id);
  const submit = () => {
    const missing = total - answered;
    if (missing > 0 && !window.confirm(`${missing} question(s) are unanswered and will count as wrong. Submit anyway?`)) return;
    finish();
    onFinished();
  };

  return (
    <div>
      <div className="exam-bar">
        <span className={`exam-clock ${left < 10 * 60_000 ? 'low' : ''}`} role="timer" aria-label="Time left">
          ⏱ {fmtClock(left)}
        </span>
        <span className="hint">
          {answered}/{total} answered · {attempt.flagged.length} flagged
        </span>
        <button className="btn small" onClick={() => setOverview(!overview)} aria-expanded={overview}>
          {overview ? 'Back to the question' : 'Review all'}
        </button>
        <button className="btn small primary" onClick={submit}>
          Submit
        </button>
      </div>
      {overview ? (
        <div>
          <p className="hint">Jump to any question. Flagged ones are marked ⚑; unanswered ones are hollow.</p>
          <div className="exam-grid">
            {attempt.questionIds.map((qid, i) => (
              <button
                key={qid}
                className={`exam-cell ${attempt.answers[qid]?.length ? 'done' : ''} ${attempt.flagged.includes(qid) ? 'flag' : ''} ${i === idx ? 'on' : ''}`}
                onClick={() => {
                  setIdx(i);
                  setOverview(false);
                }}
                aria-label={`Question ${i + 1}${attempt.answers[qid]?.length ? ', answered' : ', unanswered'}${attempt.flagged.includes(qid) ? ', flagged' : ''}`}
              >
                {i + 1}
                {attempt.flagged.includes(qid) && <span aria-hidden> ⚑</span>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        q && (
          <div>
            <p className="hint">
              Question {idx + 1} of {total} · {multi ? `Choose ${q.correct.length === 2 ? 'TWO' : q.correct.length}` : 'Choose ONE'}
            </p>
            <p className="q-stem">{q.stem}</p>
            <div role={multi ? 'group' : 'radiogroup'} aria-label="Options">
              {displayOptions(q).map((o, i) => {
                const isChosen = chosen.includes(o.id);
                return (
                  <button
                    key={o.id}
                    className={`q-opt ${isChosen ? 'chosen' : ''}`}
                    role={multi ? 'checkbox' : 'radio'}
                    aria-checked={isChosen}
                    onClick={() => answer(id, multi ? (isChosen ? chosen.filter((x) => x !== o.id) : [...chosen, o.id]) : [o.id])}
                  >
                    <span className="mono">{letter(i)}.</span>
                    <span>{o.text}</span>
                  </button>
                );
              })}
            </div>
            <div className="exam-nav">
              <button className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
                ← Previous
              </button>
              <button className={`btn ${flagged ? 'on' : ''}`} aria-pressed={flagged} onClick={() => toggleFlag(id)}>
                ⚑ {flagged ? 'Flagged' : 'Flag for review'}
              </button>
              {idx < total - 1 ? (
                <button className="btn primary" onClick={() => setIdx(idx + 1)}>
                  Next →
                </button>
              ) : (
                <button className="btn primary" onClick={() => setOverview(true)}>
                  Review all
                </button>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}

export function ExamMode() {
  const open = useGame((s) => s.examOpen);
  const setOpen = useGame((s) => s.openExam);
  const attempt = useGame((s) => s.currentExam());
  const last = useGame((s) => s.exams[s.exams.length - 1]);
  const start = useGame((s) => s.startExam);
  const finish = useGame((s) => s.finishExam);
  const abandon = useGame((s) => s.abandonExam);
  const toast = useGame((s) => s.toast);
  const [view, setView] = useState<'home' | 'results' | 'review'>('home');
  const now = useNow(open && !!attempt);

  // Time's up: submit what's there.
  const expired = !!attempt && now - new Date(attempt.startedAt).getTime() >= LIMIT_MS;
  useEffect(() => {
    if (!expired) return;
    finish();
    setView('results');
    toast("Time's up: the exam was submitted.", 'info');
  }, [expired, finish, toast]);

  if (!open) return null;
  const close = () => {
    setOpen(false);
    setView('home');
  };
  const showResults = !attempt && last?.finishedAt && view !== 'home';
  return (
    <div className="modal-back" onClick={close} role="dialog" aria-modal aria-label="Practice exam">
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Practice exam</h2>
          {attempt && (
            <button
              className="btn ghost small"
              onClick={() => {
                if (window.confirm('Abandon this attempt? Your answers will be discarded.')) abandon();
              }}
            >
              Abandon
            </button>
          )}
          {showResults && view === 'review' && (
            <button className="btn ghost small" onClick={() => setView('results')}>
              ← Results
            </button>
          )}
          <button className="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body">
          {attempt ? (
<InProgress attempt={attempt} now={now} key={attempt.id} onFinished={() => setView('results')} />
          ) : showResults ? (
            view === 'review' ? <ReviewAnswers attempt={last} /> : <Results attempt={last} onReview={() => setView('review')} />
          ) : (
            <StartScreen
              onStart={() => {
                start();
                setView('results');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
