import type { Board } from '../engine/model';
import type { Evidence } from '../engine/mastery/evidence';
import { evidenceFor } from '../engine/mastery/evidence';
import type { DailyPlan } from '../engine/mastery/daily';
import { QUESTION_BY_ID } from '../content/questions';
import { MISSION_BY_ID } from '../content/missions';

export const SCHEMA_VERSION = 3;

export interface BestResult {
  stars: 0 | 1 | 2 | 3;
  points: number;
  at: string;
}

export interface QuestionAnswer {
  questionId: string;
  chosen: string[];
  correct: boolean;
  at: string;
}

export interface Settings {
  reducedMotion: boolean;
}

/** Stage 2: where an incident investigation stands. */
export interface IncidentProgress {
  /** Distinct investigation actions taken (object opened, log viewed, ad-hoc trace). */
  actions: string[];
  /** Suspect id the player named as the root cause. */
  diagnosis: string | null;
  /** Set on the first "Verify fix": the diagnosis is locked from then on. */
  verifiedAt?: string;
}

/** Stage 2: answer to a Spot the Difference round (first answer counts). */
export interface DiffAnswer {
  chosen: string;
  correct: boolean;
  at: string;
}

/** Stage 4: one day's session, frozen when first opened that day. */
export interface DailyRecord {
  plan: DailyPlan;
  /** Item id → answered correctly. */
  done: Record<string, boolean>;
}

/** Stage 4: a Defend round answer. */
export interface DefendAnswer {
  answer: string;
  /** Indexes of the rubric points the player ticked. */
  covered: number[];
  at: string;
}

/** Stage 4: a practice exam attempt. The last one may still be in progress (no finishedAt). */
export interface ExamAttempt {
  id: string;
  startedAt: string;
  questionIds: string[];
  answers: Record<string, string[]>;
  flagged: string[];
  finishedAt?: string;
  score?: { scaled: number; correct: number; total: number; pass: boolean; byDomain: Record<string, { correct: number; total: number }> };
}

/** Everything that is persisted and exported. */
export interface PersistedState {
  schemaVersion: number;
  currentMissionId: string;
  boards: Record<string, Board>;
  best: Record<string, BestResult>;
  questionHistory: QuestionAnswer[];
  /** Stage 4: evidence per concept (mastery and spaced repetition are derived from it). */
  conceptEvidence: Evidence[];
  settings: Settings;
  incidents: Record<string, IncidentProgress>;
  diffAnswers: Record<string, DiffAnswer>;
  // ----- Stage 4 (schema v3) -----
  /** Daily sessions by local date (YYYY-MM-DD). */
  daily: Record<string, DailyRecord>;
  /** Defend answers by `missionId/eventId`. */
  defends: Record<string, DefendAnswer>;
  exams: ExamAttempt[];
  tutorial: { done: boolean; step: number };
}

const validTime = (at: unknown): at is string => typeof at === 'string' && !Number.isNaN(Date.parse(at));

/** Evidence an older save already earned: answered questions, Spot the Difference answers, verified diagnoses. */
export function backfillEvidence(s: any): Evidence[] {
  const out: Evidence[] = [];
  for (const h of s.questionHistory ?? []) {
    const q = QUESTION_BY_ID[h.questionId];
    if (q && validTime(h.at)) out.push(...evidenceFor('question', q.id, q.concepts, !!h.correct, h.at));
  }
  for (const [id, a] of Object.entries<any>(s.diffAnswers ?? {})) {
    const m = MISSION_BY_ID[id];
    if (m && validTime(a.at)) out.push(...evidenceFor('diff', id, m.concepts, !!a.correct, a.at));
  }
  for (const [id, p] of Object.entries<any>(s.incidents ?? {})) {
    const m = MISSION_BY_ID[id];
    if (m?.incident && p.diagnosis && validTime(p.verifiedAt)) out.push(...evidenceFor('incident', id, m.concepts, p.diagnosis === m.incident.rootCause, p.verifiedAt));
  }
  return out;
}

export const MIGRATIONS: Record<number, (s: any) => any> = {
  // 0 → 1: pre-release saves had no evidence or settings.
  0: (s) => ({ ...s, conceptEvidence: s.conceptEvidence ?? [], settings: s.settings ?? { reducedMotion: false } }),
  // 1 → 2: Stage 2 adds incident investigations and Spot the Difference answers.
  1: (s) => ({ ...s, incidents: s.incidents ?? {}, diffAnswers: s.diffAnswers ?? {} }),
  // 2 → 3: Stage 4 adds daily sessions, Defend answers, exams and the tutorial, and backfills
  // concept evidence from answers the save already holds. Players with progress skip the tutorial.
  2: (s) => ({
    ...s,
    conceptEvidence: (s.conceptEvidence ?? []).length ? s.conceptEvidence : backfillEvidence(s),
    daily: s.daily ?? {},
    defends: s.defends ?? {},
    exams: s.exams ?? [],
    tutorial: s.tutorial ?? { done: Object.keys(s.best ?? {}).length > 0 || Object.keys(s.boards ?? {}).length > 0, step: 0 },
  }),
};

export function migrate(state: any, fromVersion: number): PersistedState {
  let s = state;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) s = MIGRATIONS[v] ? MIGRATIONS[v](s) : s;
  return { ...s, schemaVersion: SCHEMA_VERSION };
}

export function validateImport(data: unknown): PersistedState {
  if (!data || typeof data !== 'object') throw new Error('Not a Blast Radius progress file.');
  const d = data as any;
  if (d.app !== 'blast-radius' || typeof d.state !== 'object') throw new Error('Not a Blast Radius progress file.');
  const version = Number(d.state.schemaVersion ?? 0);
  if (version > SCHEMA_VERSION) throw new Error(`This file was made by a newer version (schema ${version}).`);
  const s = migrate(d.state, version);
  if (typeof s.boards !== 'object' || typeof s.best !== 'object' || !Array.isArray(s.questionHistory) || typeof s.incidents !== 'object' || typeof s.diffAnswers !== 'object') throw new Error('Progress file is incomplete.');
  if (!Array.isArray(s.conceptEvidence) || typeof s.daily !== 'object' || typeof s.defends !== 'object' || !Array.isArray(s.exams) || typeof s.tutorial !== 'object') throw new Error('Progress file is incomplete.');
  return s;
}
