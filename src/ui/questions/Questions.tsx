import { useState } from 'react';
import { QUESTION_BY_ID } from '../../content/questions';
import { useGame } from '../../store/game';
import { QuestionCard } from './QuestionCard';

export function Questions() {
  const open = useGame((s) => s.questionsOpen);
  const setOpen = useGame((s) => s.openQuestions);
  const mission = useGame((s) => s.mission());
  const practice = useGame((s) => s.practice);
  const answer = useGame((s) => s.answerQuestion);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  if (!open) return null;
  const ids = practice?.questionIds ?? mission.questions;
  const done = idx >= ids.length;
  const q = !done ? QUESTION_BY_ID[ids[idx]] : null;
  const close = () => {
    setOpen(false);
    setIdx(0);
    setScore(0);
  };
  return (
    <div className="modal-back" onClick={close} role="dialog" aria-modal aria-label={practice ? practice.title : 'Transfer questions'}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{practice ? practice.title : 'Transfer questions'}</h2>
          <span className="hint">{done ? 'Done' : `${idx + 1} / ${ids.length}`}</span>
          <button className="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body">
          {done ? (
            <div>
              <p className="q-stem">
                You got <b>{score}</b> of {ids.length}.{' '}
                {practice ? 'Each answer counts as evidence on your concept map.' : 'These questions use different stories on purpose: if you got them, the concepts transferred.'}
              </p>
              <button className="btn primary" onClick={close} autoFocus>
                {practice ? 'Done' : 'Back to the board'}
              </button>
            </div>
          ) : (
            q && (
              <QuestionCard
                key={q.id}
                q={q}
                onAnswer={(chosen, ok) => {
                  answer(q.id, chosen, ok);
                  if (ok) setScore((s) => s + 1);
                }}
                onNext={() => setIdx(idx + 1)}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
