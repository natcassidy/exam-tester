// Mastery = weighted recent accuracy. Each piece of evidence counts with its weight, halved every
// HALF_LIFE_DAYS, plus a small prior at 50% so one lucky answer doesn't read as mastered.

import type { ConceptId } from '../model';
import type { Evidence } from './evidence';

export const HALF_LIFE_DAYS = 30;
const PRIOR_WEIGHT = 1;
const PRIOR = 0.5;
const DAY_MS = 86_400_000;

export type MasteryLevel = 'new' | 'weak' | 'learning' | 'strong';

export interface Mastery {
  conceptId: ConceptId;
  /** 0..1 */
  score: number;
  /** Decayed evidence weight behind the score. */
  confidence: number;
  level: MasteryLevel;
  count: number;
  lastAt: string | null;
}

export function decay(at: string, now: string): number {
  const ageDays = Math.max(0, (Date.parse(now) - Date.parse(at)) / DAY_MS);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

export function levelOf(score: number, count: number): MasteryLevel {
  if (!count) return 'new';
  if (score < 0.5) return 'weak';
  if (score < 0.75) return 'learning';
  return 'strong';
}

export function mastery(evidence: Evidence[], conceptId: ConceptId, now: string): Mastery {
  let num = PRIOR * PRIOR_WEIGHT;
  let den = PRIOR_WEIGHT;
  let count = 0;
  let lastAt: string | null = null;
  for (const e of evidence) {
    if (e.conceptId !== conceptId) continue;
    const w = e.weight * decay(e.at, now);
    num += w * (e.correct ? 1 : 0);
    den += w;
    count++;
    if (!lastAt || Date.parse(e.at) > Date.parse(lastAt)) lastAt = e.at;
  }
  const score = num / den;
  return { conceptId, score, confidence: den - PRIOR_WEIGHT, level: levelOf(score, count), count, lastAt };
}

export function masteryAll(evidence: Evidence[], conceptIds: ConceptId[], now: string): Record<ConceptId, Mastery> {
  return Object.fromEntries(conceptIds.map((c) => [c, mastery(evidence, c, now)]));
}
