// Exam mode: a 65-question practice exam drawn from the bank with the SAA-C03 domain weights.
// Deterministic for a given seed, so tests (and a resumed attempt) see the same paper.

import type { Domain, Question, QuestionId } from '../model';

/** SAA-C03 content domains and weights (checked against the exam guide in 2026). */
export const DOMAIN_WEIGHTS: Record<Domain, number> = { secure: 0.3, resilient: 0.26, performant: 0.24, cost: 0.2 };
export const DOMAIN_ORDER: Domain[] = ['secure', 'resilient', 'performant', 'cost'];

export const EXAM_QUESTIONS = 65;
export const EXAM_MINUTES = 130;
export const PASS_SCALED = 720;

/** Questions per domain for an exam of `total` questions (largest remainder). */
export function domainCounts(total: number): Record<Domain, number> {
  const raw = DOMAIN_ORDER.map((d) => ({ d, exact: total * DOMAIN_WEIGHTS[d] }));
  const counts = Object.fromEntries(raw.map((r) => [r.d, Math.floor(r.exact)])) as Record<Domain, number>;
  let left = total - Object.values(counts).reduce((a, b) => a + b, 0);
  for (const r of [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || DOMAIN_ORDER.indexOf(a.d) - DOMAIN_ORDER.indexOf(b.d))) {
    if (left-- <= 0) break;
    counts[r.d]++;
  }
  return counts;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Draw a weighted exam. Never repeats a question; interleaves domains like the real exam. */
export function drawExam(bank: Question[], seed: string, total = EXAM_QUESTIONS): QuestionId[] {
  const rand = rng(hashString(seed));
  const counts = domainCounts(total);
  const picked: Question[] = [];
  for (const d of DOMAIN_ORDER) {
    const pool = shuffle(bank.filter((q) => q.domain === d).sort((a, b) => a.id.localeCompare(b.id)), rand);
    if (pool.length < counts[d]) throw new Error(`The bank has ${pool.length} ${d} questions; the exam needs ${counts[d]}.`);
    picked.push(...pool.slice(0, counts[d]));
  }
  return shuffle(picked, rand).map((q) => q.id);
}

/**
 * Options in a stable per-question order. Many bank questions (and every Spot the Difference round)
 * list the answer first, so every question surface shows a shuffled order and letters by position;
 * answers keep the option ids. Pass a question, or `{ id: missionId, options }` for a diff round.
 */
export function displayOptions<O extends { id: string }>(q: { id: string; options: O[] }): O[] {
  return [...q.options].sort((a, b) => hashString(`${q.id}:${a.id}`) - hashString(`${q.id}:${b.id}`));
}

export const letter = (i: number) => String.fromCharCode(65 + i);

export function isCorrect(q: Question, chosen: string[] | undefined): boolean {
  return !!chosen && chosen.length === q.correct.length && q.correct.every((c) => chosen.includes(c));
}

export interface ExamScore {
  correct: number;
  total: number;
  pct: number;
  /** Approximate scaled score, 100-1000. */
  scaled: number;
  pass: boolean;
  byDomain: Record<Domain, { correct: number; total: number }>;
}

/**
 * AWS reports a scaled score (100-1000, pass at 720) and doesn't publish the conversion.
 * This estimate maps the share of correct answers linearly onto 100-1000.
 */
export function scaledScore(pct: number): number {
  return Math.round(100 + 900 * Math.max(0, Math.min(1, pct)));
}

export function scoreExam(ids: QuestionId[], byId: Record<string, Question>, answers: Record<string, string[]>): ExamScore {
  const byDomain = Object.fromEntries(DOMAIN_ORDER.map((d) => [d, { correct: 0, total: 0 }])) as ExamScore['byDomain'];
  let correct = 0;
  for (const id of ids) {
    const q = byId[id];
    if (!q) continue;
    const ok = isCorrect(q, answers[id]);
    byDomain[q.domain].total++;
    if (ok) {
      byDomain[q.domain].correct++;
      correct++;
    }
  }
  const pct = ids.length ? correct / ids.length : 0;
  const scaled = scaledScore(pct);
  return { correct, total: ids.length, pct, scaled, pass: scaled >= PASS_SCALED, byDomain };
}
