import { useMemo, useState } from 'react';
import type { DailyItem } from '../../engine/mastery/daily';
import { streak } from '../../engine/mastery/daily';
import { miniIncidentOptions } from '../../engine/incident/mini';
import { CONCEPT_BY_ID } from '../../content/concepts';
import { MISSION_BY_ID } from '../../content/missions';
import { QUESTION_BY_ID } from '../../content/questions';
import { dailyComplete, localDay, useGame } from '../../store/game';
import { QuestionCard } from '../questions/QuestionCard';

function DiffItem({ missionId, onAnswer, onNext }: { missionId: string; onAnswer: (ok: boolean) => void; onNext: () => void }) {
  const m = MISSION_BY_ID[missionId];
  const d = m.diff!;
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <div>
      <p className="hint">Spot the Difference · {m.title}</p>
      <p className="q-stem">{m.brief}</p>
      <p className="hint">
        {d.leftLabel} vs. {d.rightLabel}. {d.question}
      </p>
      {d.options.map((o) => {
        const cls = chosen ? (o.id === d.correct ? 'right' : o.id === chosen ? 'wrong' : '') : '';
        return (
          <button
            key={o.id}
            className={`q-opt ${cls}`}
            disabled={!!chosen}
            onClick={() => {
              setChosen(o.id);
              onAnswer(o.id === d.correct);
            }}
          >
            <span className="mono">{o.id.toUpperCase()}.</span>
            <span>{o.text}</span>
            {chosen && <span className="why">{o.why}</span>}
          </button>
        );
      })}
      {chosen && (
        <>
          <p className="lesson">{d.explanation}</p>
          <button className="btn primary" onClick={onNext} autoFocus>
            Next →
          </button>
        </>
      )}
    </div>
  );
}

function IncidentItem({ missionId, onAnswer, onNext }: { missionId: string; onAnswer: (ok: boolean) => void; onNext: () => void }) {
  const m = MISSION_BY_ID[missionId];
  const inc = m.incident!;
  const options = useMemo(() => miniIncidentOptions(m), [m]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [log, setLog] = useState(inc.logs[0]?.id ?? null);
  const current = inc.logs.find((l) => l.id === log);
  return (
    <div>
      <p className="hint">Mini-incident · {m.title}</p>
      <div className="alert-banner" role="alert">
        <b>{inc.alert.title}</b>
        <span className="hint">{inc.alert.detail}</span>
      </div>
      <p className="q-stem">{m.brief}</p>
      <div className="mini-logs">
        <div role="tablist" aria-label="Log sources" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {inc.logs.map((l) => (
            <button key={l.id} role="tab" aria-selected={log === l.id} className={`btn small ${log === l.id ? '' : 'ghost'}`} onClick={() => setLog(l.id)}>
              {l.title}
            </button>
          ))}
        </div>
        {current && (
          <pre className="log-lines" tabIndex={0}>
            {current.lines.join('\n')}
          </pre>
        )}
      </div>
      <p className="hint">What is the root cause?</p>
      {options.map((s) => {
        const right = s.id === inc.rootCause;
        const cls = chosen ? (right ? 'right' : s.id === chosen ? 'wrong' : '') : '';
        return (
          <button
            key={s.id}
            className={`q-opt ${cls}`}
            disabled={!!chosen}
            onClick={() => {
              setChosen(s.id);
              onAnswer(right);
            }}
          >
            <span className="mono">•</span>
            <span>
              {s.group} · {s.label}
            </span>
          </button>
        );
      })}
      {chosen && (
        <>
          <p className="lesson">{inc.rootCauseExplain}</p>
          <button className="btn primary" onClick={onNext} autoFocus>
            Next →
          </button>
        </>
      )}
    </div>
  );
}

function itemTitle(i: DailyItem): string {
  if (i.kind === 'question') return 'Question';
  if (i.kind === 'diff') return 'Spot the Difference';
  return 'Mini-incident';
}

export function DailySession() {
  const open = useGame((s) => s.dailyOpen);
  const openDaily = useGame((s) => s.openDaily);
  const daily = useGame((s) => s.daily);
  const complete = useGame((s) => s.completeDailyItem);
  const openMap = useGame((s) => s.openMap);
  const [idx, setIdx] = useState<number | null>(null);
  if (!open) return null;
  const today = localDay();
  const rec = daily[today];
  if (!rec) return null;
  const items = rec.plan.items;
  const firstOpen = items.findIndex((i) => !(i.id in rec.done));
  const at = idx ?? (firstOpen < 0 ? items.length : firstOpen);
  const item = items[at];
  const doneDays = Object.entries(daily).filter(([, r]) => dailyComplete(r)).map(([d]) => d);
  const st = streak(doneDays, today);
  const correct = Object.values(rec.done).filter(Boolean).length;
  const close = () => {
    openDaily(false);
    setIdx(null);
  };
  const next = () => {
    const n = items.findIndex((i, k) => k > at && !(i.id in rec.done));
    setIdx(n < 0 ? items.length : n);
  };
  const answer = (id: string, ok: boolean, chosen?: string[]) => {
    setIdx(at); // keep this item on screen while its explanation is read
    complete(id, ok, chosen);
  };
  return (
    <div className="modal-back" onClick={close} role="dialog" aria-modal aria-label="Daily session">
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Today's session</h2>
          <span className="tag muted" title="Consecutive days with a completed session">
            {st ? `🔥 ${st}-day streak` : 'Finish today to start a streak'}
          </span>
          <button className="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="daily-steps" aria-label="Progress">
          {items.map((i, n) => (
            <span key={i.id} className={`step ${i.id in rec.done ? (rec.done[i.id] ? 'ok' : 'miss') : ''} ${n === at ? 'on' : ''}`} title={itemTitle(i)} />
          ))}
        </div>
        <div className="panel-body">
          {at === 0 && !Object.keys(rec.done).length && (
            <p className="hint">
              About 10 minutes, built from what's due:{' '}
              {rec.plan.focus.map((c, i) => (
                <span key={c}>
                  {i > 0 && ', '}
                  <button className="linkish" onClick={() => openMap(c)}>
                    {CONCEPT_BY_ID[c]?.title ?? c}
                  </button>
                  {rec.plan.reasons[c] === 'new' ? ' (new)' : rec.plan.reasons[c] === 'due' ? ' (due)' : ''}
                </span>
              ))}
              .
            </p>
          )}
          {!item ? (
            <div>
              <p className="q-stem">
                {dailyComplete(rec) ? (
                  <>
                    Session complete: <b>{correct}</b> of {items.length} right. Streak: <b>{st}</b> day{st === 1 ? '' : 's'}. Concepts you missed come back tomorrow; the ones you got move further out.
                  </>
                ) : (
                  'Some items are still open. Come back to finish them today to keep the streak.'
                )}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={close} autoFocus>
                  Done
                </button>
                <button className="btn" onClick={() => openMap('index')}>
                  Open the concept map
                </button>
              </div>
            </div>
          ) : item.kind === 'question' ? (
            <QuestionCard key={item.id} q={QUESTION_BY_ID[item.questionId]} onAnswer={(chosen, ok) => answer(item.id, ok, chosen)} onNext={next} />
          ) : item.kind === 'diff' ? (
            <DiffItem key={item.id} missionId={item.missionId} onAnswer={(ok) => answer(item.id, ok)} onNext={next} />
          ) : (
            <IncidentItem key={item.id} missionId={item.missionId} onAnswer={(ok) => answer(item.id, ok)} onNext={next} />
          )}
        </div>
      </div>
    </div>
  );
}
