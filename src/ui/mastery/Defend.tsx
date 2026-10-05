import { useState } from 'react';
import type { Board, EventResult, Mission } from '../../engine/model';
import { DEFENDS } from '../../content/defend';
import { MISSION_BY_ID } from '../../content/missions';
import { SERVICES } from '../../content/services';
import { useGame } from '../../store/game';
import { nodeSubtitle } from '../board/describe';

/** A ready-made prompt for grading the answer in a Claude chat. */
export function claudePrompt(m: Mission, eventId: string, board: Board, result: EventResult | undefined, answer: string): string {
  const ev = m.events.find((e) => e.id === eventId)!;
  const d = DEFENDS[`${m.id}/${eventId}`];
  const design = Object.values(board.components).map((c) => `- ${c.name} (${SERVICES[c.type].name}): ${nodeSubtitle(board, c)}`);
  return [
    'Please grade a short architecture justification I wrote while studying for the AWS Certified Solutions Architect – Associate exam.',
    '',
    `Scenario (${m.client}): ${m.brief}`,
    m.refactor ? `Requirement change: ${m.refactor.change}` : '',
    'Requirements:',
    ...m.requirements.map((r) => `- ${r.text}`),
    '',
    `Event: ${ev.name}. ${ev.desc}`,
    result ? `Simulated result: ${result.status.toUpperCase()}. ${result.summary}` : '',
    '',
    'My design:',
    ...(design.length ? design : ['- (empty board)']),
    '',
    `Question: ${d.prompt}`,
    `My answer: ${answer.trim() || '(no answer)'}`,
    '',
    'Rubric (points a complete answer covers):',
    ...d.rubric.map((r, i) => `${i + 1}. ${r}`),
    '',
    'Tell me which rubric points I covered, correct anything that is inaccurate about how AWS works, and suggest a stronger 1-2 sentence answer. Keep it short.',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function DefendModal() {
  const d = useGame((s) => s.defend);
  const openDefend = useGame((s) => s.openDefend);
  const saved = useGame((s) => (d ? s.defends[`${d.missionId}/${d.eventId}`] : undefined));
  const results = useGame((s) => (d ? s.results[d.missionId] : undefined));
  const board = useGame((s) => s.board());
  const save = useGame((s) => s.saveDefend);
  const toast = useGame((s) => s.toast);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [covered, setCovered] = useState<number[]>([]);
  const [promptText, setPromptText] = useState<string | null>(null);
  if (!d) return null;
  const spec = DEFENDS[`${d.missionId}/${d.eventId}`];
  const m = MISSION_BY_ID[d.missionId];
  if (!spec || !m) return null;
  const result = results?.find((r) => r.eventId === d.eventId);
  const close = () => {
    openDefend(null);
    setAnswer('');
    setRevealed(false);
    setCovered([]);
    setPromptText(null);
  };
  const copy = async () => {
    const text = claudePrompt(m, d.eventId, board, result, answer || saved?.answer || '');
    if (await copyText(text)) toast('Copied. Paste it into a Claude chat to get your answer graded.', 'success');
    else setPromptText(text);
  };
  return (
    <div className="modal-back" onClick={close} role="dialog" aria-modal aria-label="Defend your design">
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Defend your design</h2>
          <span className="hint">Self-graded · counts half as much as a simulation</span>
          <button className="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body">
          <p className="q-stem">{spec.prompt}</p>
          <label className="field stack">
            <span>Your answer, in 1-2 sentences</span>
            <textarea rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={revealed} placeholder={saved ? `Last time: ${saved.answer}` : 'Name the mechanism and why it meets the requirement.'} autoFocus />
          </label>
          {!revealed ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn primary" disabled={answer.trim().length < 10} onClick={() => setRevealed(true)}>
                Reveal the model answer
              </button>
              <button className="btn" onClick={copy} title="Copies the scenario, your design and your answer as a prompt">
                Copy for Claude
              </button>
            </div>
          ) : (
            <>
              <div className="section">
                <h4>Model answer</h4>
                <p>{spec.model}</p>
              </div>
              <div className="section">
                <h4>Tick the points your answer covered</h4>
                {spec.rubric.map((r, i) => (
                  <label key={i} className="check" style={{ display: 'flex', padding: '4px 0' }}>
                    <input type="checkbox" checked={covered.includes(i)} onChange={(e) => setCovered(e.target.checked ? [...covered, i] : covered.filter((x) => x !== i))} />
                    <span>{r}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn primary"
                  onClick={() => {
                    save(d.missionId, d.eventId, answer, covered, spec.rubric.length);
                    toast(`Saved: ${covered.length}/${spec.rubric.length} points.`, 'success');
                    close();
                  }}
                >
                  Save ({covered.length}/{spec.rubric.length})
                </button>
                <button className="btn" onClick={copy}>
                  Copy for Claude
                </button>
              </div>
            </>
          )}
          {promptText && (
            <label className="field stack" style={{ marginTop: 10 }}>
              <span>Copying isn't allowed here. Select this text and copy it yourself:</span>
              <textarea rows={8} readOnly value={promptText} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
