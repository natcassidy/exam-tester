import type { Board } from '../engine/model';

export const SCHEMA_VERSION = 1;

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
}

export const MIGRATIONS: Record<number, (s: any) => any> = {
  // 0 → 1: pre-release saves had no evidence or settings.
  0: (s) => ({ ...s, conceptEvidence: s.conceptEvidence ?? [], settings: s.settings ?? { reducedMotion: false } }),
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
  if (typeof s.boards !== 'object' || typeof s.best !== 'object' || !Array.isArray(s.questionHistory)) throw new Error('Progress file is incomplete.');
  return s;
}
