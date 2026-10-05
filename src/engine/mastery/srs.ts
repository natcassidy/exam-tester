// Leitner spaced repetition over concepts. Pure functions: every date is passed in.
//
// Boxes 1-5 with review intervals of 1, 2, 4, 8 and 16 days.
// - Incorrect evidence sends a concept back to box 1.
// - Correct evidence moves it up one box, but only once it is due: answering the same concept
//   ten times in one evening is cramming and doesn't skip it ahead.
// - Evidence recorded at the same moment (one simulation run, one exam) is one review: it is
//   correct only if every item in it is.

import type { ConceptId } from '../model';
import type { Evidence } from './evidence';

export const INTERVAL_DAYS = [1, 2, 4, 8, 16] as const;
export const MAX_BOX = 5;
const DAY_MS = 86_400_000;

export interface SrsCard {
  conceptId: ConceptId;
  /** 0 = never seen; 1-5 = Leitner box. */
  box: number;
  /** Last review that moved the card (ISO). */
  reviewedAt: string | null;
  /** When the card is next due (ISO); null for unseen cards. */
  dueAt: string | null;
  reviews: number;
}

export function intervalDays(box: number): number {
  return INTERVAL_DAYS[Math.max(1, Math.min(MAX_BOX, box)) - 1];
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

/** Group a concept's evidence into reviews (same timestamp = one review), oldest first. */
export function reviewsOf(evidence: Evidence[], conceptId: ConceptId): { at: string; correct: boolean }[] {
  const byAt = new Map<string, boolean>();
  for (const e of evidence) {
    if (e.conceptId !== conceptId) continue;
    byAt.set(e.at, (byAt.get(e.at) ?? true) && e.correct);
  }
  return [...byAt.entries()].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0])).map(([at, correct]) => ({ at, correct }));
}

export function srsCard(evidence: Evidence[], conceptId: ConceptId): SrsCard {
  let box = 0;
  let reviewedAt: string | null = null;
  let reviews = 0;
  for (const r of reviewsOf(evidence, conceptId)) {
    reviews++;
    if (!r.correct) {
      box = 1;
      reviewedAt = r.at;
      continue;
    }
    if (box === 0) {
      box = 1;
      reviewedAt = r.at;
      continue;
    }
    const due = Date.parse(addDays(reviewedAt!, intervalDays(box)));
    if (Date.parse(r.at) >= due) {
      box = Math.min(MAX_BOX, box + 1);
      reviewedAt = r.at;
    }
  }
  return { conceptId, box, reviewedAt, dueAt: reviewedAt ? addDays(reviewedAt, intervalDays(box)) : null, reviews };
}

export function isDue(card: SrsCard, now: string): boolean {
  return card.dueAt !== null && Date.parse(card.dueAt) <= Date.parse(now);
}

export function srsCards(evidence: Evidence[], conceptIds: ConceptId[]): Record<ConceptId, SrsCard> {
  return Object.fromEntries(conceptIds.map((c) => [c, srsCard(evidence, c)]));
}
