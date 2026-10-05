// The daily session (~10 minutes): built from the concepts that are due, weakest first.
// Deterministic: the same store state and date always give the same session.

import type { Concept, ConceptId, Question } from '../model';
import type { Evidence } from './evidence';
import { dayOf } from './evidence';
import { mastery } from './mastery';
import { isDue, srsCard } from './srs';

export type DailyItem =
  | { id: string; kind: 'question'; questionId: string }
  | { id: string; kind: 'diff'; missionId: string }
  | { id: string; kind: 'incident'; missionId: string };

export interface DailyPlan {
  date: string;
  /** Concepts the session targets, in priority order. */
  focus: ConceptId[];
  /** Why each focus concept was picked. */
  reasons: Record<ConceptId, 'due' | 'new' | 'weakest'>;
  items: DailyItem[];
}

export interface DailyInput {
  /** The player's local date (YYYY-MM-DD); defaults to the UTC date of `now`. */
  today?: string;
  evidence: Evidence[];
  questionHistory: { questionId: string; at: string }[];
  now: string;
  concepts: Concept[];
  questions: Question[];
  diffs: { id: string; concepts: ConceptId[] }[];
  incidents: { id: string; concepts: ConceptId[] }[];
}

export const DAILY_FOCUS = 5;
export const DAILY_QUESTIONS = 5;

/** Most recent time an item with this source id was played (evidence or history), or '' if never. */
function lastPlayed(evidence: Evidence[], source: string): string {
  let last = '';
  for (const e of evidence) if (e.source === source && e.at > last) last = e.at;
  return last;
}

export function buildDailySession(input: DailyInput): DailyPlan {
  const { evidence, now } = input;
  const ids = input.concepts.map((c) => c.id);
  const cards = ids.map((id) => ({ id, card: srsCard(evidence, id), m: mastery(evidence, id, now).score }));
  const byWeakest = (a: (typeof cards)[number], b: (typeof cards)[number]) => a.m - b.m || a.id.localeCompare(b.id);
  const due = cards.filter((c) => isDue(c.card, now)).sort(byWeakest);
  const fresh = cards.filter((c) => c.card.box === 0); // keeps the exam-guide order of CONCEPTS
  const rest = cards.filter((c) => c.card.box > 0 && !isDue(c.card, now)).sort(byWeakest);

  const reasons: DailyPlan['reasons'] = {};
  const focus: ConceptId[] = [];
  for (const [list, why] of [[due, 'due'], [fresh, 'new'], [rest, 'weakest']] as const)
    for (const c of list) {
      if (focus.length >= DAILY_FOCUS) break;
      focus.push(c.id);
      reasons[c.id] = why;
    }

  // Questions: for each focus concept in turn, the question about it answered longest ago.
  const asked = new Map<string, string>();
  for (const h of input.questionHistory) if (h.at > (asked.get(h.questionId) ?? '')) asked.set(h.questionId, h.at);
  const questions: string[] = [];
  for (let round = 0; questions.length < DAILY_QUESTIONS && round < DAILY_QUESTIONS; round++) {
    let added = false;
    for (const c of focus) {
      if (questions.length >= DAILY_QUESTIONS) break;
      const pick = input.questions
        .filter((q) => q.concepts.includes(c) && !questions.includes(q.id))
        .sort((a, b) => (asked.get(a.id) ?? '').localeCompare(asked.get(b.id) ?? '') || a.id.localeCompare(b.id))[0];
      if (pick) {
        questions.push(pick.id);
        added = true;
      }
    }
    if (!added) break;
  }

  // One Spot the Difference round and one mini-incident: most overlap with the focus, then least recently played.
  const pickRound = (pool: { id: string; concepts: ConceptId[] }[], kind: 'diff' | 'incident') =>
    [...pool]
      .map((m) => ({ m, overlap: m.concepts.filter((c) => focus.includes(c)).length, last: lastPlayed(evidence, `${kind}:${m.id}`) }))
      .sort((a, b) => b.overlap - a.overlap || a.last.localeCompare(b.last) || a.m.id.localeCompare(b.m.id))[0]?.m.id;
  const diff = pickRound(input.diffs, 'diff');
  const incident = pickRound(input.incidents, 'incident');

  const q = questions.map((questionId): DailyItem => ({ id: `q:${questionId}`, kind: 'question', questionId }));
  const items: DailyItem[] = [...q.slice(0, 2)];
  if (diff) items.push({ id: `diff:${diff}`, kind: 'diff', missionId: diff });
  items.push(...q.slice(2, 4));
  if (incident) items.push({ id: `incident:${incident}`, kind: 'incident', missionId: incident });
  items.push(...q.slice(4));
  return { date: input.today ?? dayOf(now), focus, reasons, items };
}

/** Consecutive days with a completed session, ending today (or yesterday if today isn't done yet). */
export function streak(completedDays: string[], today: string): number {
  const done = new Set(completedDays);
  const prev = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  let d = done.has(today) ? today : prev(today);
  let n = 0;
  while (done.has(d)) {
    n++;
    d = prev(d);
  }
  return n;
}

/** Concepts due for review now, weakest first. */
export function dueConcepts(evidence: Evidence[], conceptIds: ConceptId[], now: string): ConceptId[] {
  return conceptIds
    .map((id) => ({ id, card: srsCard(evidence, id), m: mastery(evidence, id, now).score }))
    .filter((c) => isDue(c.card, now))
    .sort((a, b) => a.m - b.m || a.id.localeCompare(b.id))
    .map((c) => c.id);
}
