import { useState } from 'react';
import { QUESTION_BY_ID } from '../../content/questions';
import { manualTitle } from '../../content/manual';
import { useGame } from '../../store/game';

export function Questions() {
  const open = useGame((s) => s.questionsOpen);
  const setOpen = useGame((s) => s.openQuestions);
  const mission = useGame((s) => s.mission());
  const answer = useGame((s) => s.answerQuestion);
  const openManual = useGame((s) => s.openManual);
  const [idx, setIdx] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  if (!open) return null;
  const ids = mission.questions;
  const done = idx >= ids.length;
  const q = !done ? QUESTION_BY_ID[ids[idx]] : null;
  const multi = (q?.correct.length ?? 1) > 1;
  const close = () => {
    setOpen(false);
    setIdx(0);
    setChosen([]);
    setRevealed(false);
    setScore(0);
  };
  const submit = () => {
    if (!q) return;
    const ok = chosen.length === q.correct.length && q.correct.every((c) => chosen.includes(c));
    answer(q.id, chosen, ok);
    if (ok) setScore((s) => s + 1);
    setRevealed(true);
  };
  return (
    <div className="modal-back" onClick={close} role="dialog" aria-modal aria-label="Transfer questions">
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Transfer questions</h2>
          <span className="hint">{done ? 'Done' : `${idx + 1} / ${ids.length}`}</span>
          <button className="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body">
          {done ? (
            <div>
              <p className="q-stem">
                You got <b>{score}</b> of {ids.length}. These questions use different stories on purpose: if you got them, the concepts transferred.
              </p>
              <button className="btn primary" onClick={close}>
                Back to the board
              </button>
            </div>
          ) : (
            q && (
              <>
                <p className="hint">
                  {q.difficulty === 3 ? 'Hard' : q.difficulty === 2 ? 'Medium' : 'Easy'} · {multi ? `Choose ${q.correct.length === 2 ? 'TWO' : q.correct.length}` : 'Choose ONE'}
                </p>
                <p className="q-stem">{q.stem}</p>
                {q.options.map((o) => {
                  const isChosen = chosen.includes(o.id);
                  const isRight = q.correct.includes(o.id);
                  const cls = revealed ? (isRight ? 'right' : isChosen ? 'wrong' : '') : isChosen ? 'chosen' : '';
                  return (
                    <button
                      key={o.id}
                      className={`q-opt ${cls}`}
                      disabled={revealed}
                      aria-pressed={isChosen}
                      onClick={() => setChosen(multi ? (isChosen ? chosen.filter((x) => x !== o.id) : [...chosen, o.id]) : [o.id])}
                    >
                      <span className="mono">{o.id.toUpperCase()}.</span>
                      <span>{o.text}</span>
                      {revealed && <span className="why">{isRight ? '✓ ' : '✗ '}{o.why}</span>}
                    </button>
                  );
                })}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {!revealed ? (
                    <button className="btn primary" disabled={!chosen.length} onClick={submit}>
                      Check answer
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      onClick={() => {
                        setIdx(idx + 1);
                        setChosen([]);
                        setRevealed(false);
                      }}
                    >
                      Next →
                    </button>
                  )}
                  {revealed &&
                    q.concepts.map((c) => (
                      <button key={c} className="btn ghost small" onClick={() => openManual(c)}>
                        ☰ {manualTitle(c)}
                      </button>
                    ))}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
