import type { Board } from '../engine/model';

export const SCHEMA_VERSION = 2;

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

/** Everything that is persisted and exported. */
export interface PersistedState {
  schemaVersion: number;
  currentMissionId: string;
  boards: Record<string, Board>;
  best: Record<string, BestResult>;
  questionHistory: QuestionAnswer[];
  /** Stage 4 fills this; kept in the schema so exports stay forward-compatible. */
  conceptEvidence: { conceptId: string; source: string; correct: boolean; weight: number; at: string }[];
  settings: Settings;
  incidents: Record<string, IncidentProgress>;
  diffAnswers: Record<string, DiffAnswer>;
}

export const MIGRATIONS: Record<number, (s: any) => any> = {
  // 0 → 1: pre-release saves had no evidence or settings.
  0: (s) => ({ ...s, conceptEvidence: s.conceptEvidence ?? [], settings: s.settings ?? { reducedMotion: false } }),
  // 1 → 2: Stage 2 adds incident investigations and Spot the Difference answers.
  1: (s) => ({ ...s, incidents: s.incidents ?? {}, diffAnswers: s.diffAnswers ?? {} }),
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
  return s;
}
