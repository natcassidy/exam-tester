import { useState } from 'react';
import type { Question } from '../../engine/model';
import { manualTitle } from '../../content/manual';
import { useGame } from '../../store/game';
import { displayOptions, letter } from '../../engine/mastery/exam';

export const isRight = (q: Question, chosen: string[]) => chosen.length === q.correct.length && q.correct.every((c) => chosen.includes(c));

/**
 * One exam-style question: choose, check, then every option's explanation and Field Manual links.
 * `onAnswer` fires once, on Check. `onNext` shows a Next button after the reveal.
 */
export function QuestionCard({ q, onAnswer, onNext, nextLabel = 'Next →' }: { q: Question; onAnswer: (chosen: string[], correct: boolean) => void; onNext?: () => void; nextLabel?: string }) {
  const openManual = useGame((s) => s.openManual);
  const [chosen, setChosen] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const multi = q.correct.length > 1;
  return (
    <div>
      <p className="hint">
        {q.difficulty === 3 ? 'Hard' : q.difficulty === 2 ? 'Medium' : 'Easy'} · {multi ? `Choose ${q.correct.length === 2 ? 'TWO' : q.correct.length}` : 'Choose ONE'}
      </p>
      <p className="q-stem">{q.stem}</p>
      <div role={multi ? 'group' : 'radiogroup'} aria-label="Options">
        {displayOptions(q).map((o, i) => {
          const isChosen = chosen.includes(o.id);
          const right = q.correct.includes(o.id);
          const cls = revealed ? (right ? 'right' : isChosen ? 'wrong' : '') : isChosen ? 'chosen' : '';
          return (
            <button
              key={o.id}
              className={`q-opt ${cls}`}
              disabled={revealed}
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={isChosen}
              onClick={() => setChosen(multi ? (isChosen ? chosen.filter((x) => x !== o.id) : [...chosen, o.id]) : [o.id])}
            >
              <span className="mono">{letter(i)}.</span>
              <span>{o.text}</span>
              {revealed && (
                <span className="why">
                  {right ? '✓ ' : '✗ '}
                  {o.why}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {!revealed ? (
          <button
            className="btn primary"
            disabled={!chosen.length}
            onClick={() => {
              onAnswer(chosen, isRight(q, chosen));
              setRevealed(true);
            }}
          >
            Check answer
          </button>
        ) : (
          <>
            <span className={`tag ${isRight(q, chosen) ? 'pass' : 'fail'}`} role="status">
              {isRight(q, chosen) ? 'Correct' : 'Not quite'}
            </span>
            {onNext && (
              <button className="btn primary" onClick={onNext} autoFocus>
                {nextLabel}
              </button>
            )}
          </>
        )}
        {revealed &&
          q.concepts.map((c) => (
            <button key={c} className="btn ghost small" onClick={() => openManual(c)}>
              ☰ {manualTitle(c)}
            </button>
          ))}
      </div>
    </div>
  );
}
