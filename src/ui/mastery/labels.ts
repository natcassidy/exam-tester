import type { Evidence } from '../../engine/mastery/evidence';
import { kindOf } from '../../engine/mastery/evidence';
import { MISSION_BY_ID } from '../../content/missions';
import { QUESTION_BY_ID } from '../../content/questions';

const KIND_LABEL: Record<string, string> = {
  event: 'Simulation',
  surprise: 'Surprise event',
  question: 'Question',
  exam: 'Practice exam',
  incident: 'Incident diagnosis',
  diff: 'Spot the Difference',
  defend: 'Defend round',
  daily: 'Daily session',
};

/** Human description of where a piece of evidence came from. */
export function evidenceLabel(e: Evidence): { kind: string; what: string } {
  const k = kindOf(e);
  const id = e.source.slice(k.length + 1);
  const kind = KIND_LABEL[k] ?? k;
  if (k === 'event' || k === 'surprise' || k === 'defend') {
    const [mid, eid] = id.split('/');
    const m = MISSION_BY_ID[mid];
    const ev = m?.events.find((x) => x.id === eid);
    return { kind, what: `${m?.title ?? mid}${ev ? ` · ${ev.name}` : eid?.startsWith('surprise-') ? ' · surprise' : ''}` };
  }
  if (k === 'question' || k === 'exam') {
    const q = QUESTION_BY_ID[id];
    return { kind, what: q ? `${q.stem.slice(0, 90)}${q.stem.length > 90 ? '…' : ''}` : id };
  }
  return { kind, what: MISSION_BY_ID[id]?.title ?? id };
}

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
