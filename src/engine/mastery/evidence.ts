// Evidence: every graded thing the player does, per concept. Pure functions, no clock reads:
// callers pass `at` (ISO time) so tests can inject dates.

import type { ConceptId, EventResult, EventSpec } from '../model';

export type EvidenceKind = 'event' | 'question' | 'incident' | 'diff' | 'defend' | 'exam' | 'daily' | 'surprise';

export interface Evidence {
  conceptId: ConceptId;
  /** `<kind>:<id>`, e.g. `event:dropshop/queue`, `question:q-ds-1`, `defend:dropshop/queue`. */
  source: string;
  correct: boolean;
  /** Objective checks weigh 1 (or more); self-graded Defend rounds weigh 0.5. */
  weight: number;
  at: string;
}

export const WEIGHTS: Record<EvidenceKind, number> = {
  event: 1,
  question: 1,
  exam: 1,
  daily: 1,
  surprise: 1,
  incident: 1.5,
  diff: 1.5,
  defend: 0.5,
};

export const kindOf = (e: Pick<Evidence, 'source'>): EvidenceKind => e.source.split(':')[0] as EvidenceKind;

export const dayOf = (iso: string): string => iso.slice(0, 10);

/**
 * Append evidence with one record per (source, concept, day):
 * - simulation events keep the LAST result of the day (the design the player ended up with);
 * - everything else keeps the FIRST answer of the day (the honest one, before seeing the explanation).
 */
export function addEvidence(list: Evidence[], items: Evidence[]): Evidence[] {
  let out = list;
  for (const e of items) {
    const i = out.findIndex((x) => x.source === e.source && x.conceptId === e.conceptId && dayOf(x.at) === dayOf(e.at));
    if (i < 0) out = [...out, e];
    else if (kindOf(e) === 'event' || kindOf(e) === 'surprise') out = [...out.slice(0, i), ...out.slice(i + 1), e];
  }
  return out;
}

const unique = (xs: string[]) => [...new Set(xs)];

/** Evidence from one simulation run: each event's concepts, pass = correct, warn = half weight. */
export function evidenceFromResults(missionId: string, events: EventSpec[], results: EventResult[], at: string, kind: 'event' | 'surprise' = 'event'): Evidence[] {
  const out: Evidence[] = [];
  for (const ev of events) {
    const r = results.find((x) => x.eventId === ev.id);
    if (!r) continue;
    for (const c of unique(ev.concepts))
      out.push({ conceptId: c, source: `${kind}:${missionId}/${ev.id}`, correct: r.status !== 'fail', weight: r.status === 'warn' ? WEIGHTS[kind] / 2 : WEIGHTS[kind], at });
  }
  return out;
}

/** Evidence for a single graded item (a question, a diagnosis, a Spot the Difference answer...). */
export function evidenceFor(kind: EvidenceKind, id: string, concepts: ConceptId[], correct: boolean, at: string, weight = WEIGHTS[kind]): Evidence[] {
  return unique(concepts).map((conceptId) => ({ conceptId, source: `${kind}:${id}`, correct, weight, at }));
}
