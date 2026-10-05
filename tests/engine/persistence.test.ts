import { describe, expect, it } from 'vitest';
import { migrate, SCHEMA_VERSION, validateImport } from '../../src/store/schema';
import { CONCEPTS } from '../../src/content/concepts';
import { mastery } from '../../src/engine/mastery/mastery';
import { srsCard } from '../../src/engine/mastery/srs';
import { evidenceFor } from '../../src/engine/mastery/evidence';

describe('progress files', () => {
  it('round-trips and migrates old saves', () => {
    const state = { schemaVersion: 0, currentMissionId: 'ledgerly', boards: {}, best: { ledgerly: { stars: 3, points: 100, at: 'x' } }, questionHistory: [] };
    const s = validateImport({ app: 'blast-radius', state });
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.conceptEvidence).toEqual([]);
    expect(s.best.ledgerly.stars).toBe(3);
    expect(s.incidents).toEqual({});
    expect(s.diffAnswers).toEqual({});
    expect(migrate(s, SCHEMA_VERSION)).toEqual(s);
  });
  it('migrates a Stage 1 (v1) save without losing boards or scores', () => {
    const v1 = { schemaVersion: 1, currentMissionId: 'dropshop', boards: { dropshop: { marker: true } }, best: { dropshop: { stars: 2, points: 70, at: 'x' } }, questionHistory: [{ questionId: 'q1', chosen: ['a'], correct: true, at: 'x' }], conceptEvidence: [], settings: { reducedMotion: true } };
    const s = validateImport({ app: 'blast-radius', state: v1 });
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.boards.dropshop).toEqual({ marker: true });
    expect(s.best.dropshop.points).toBe(70);
    expect(s.settings.reducedMotion).toBe(true);
    expect(s.incidents).toEqual({});
    expect(s.diffAnswers).toEqual({});
  });
  it('keeps Stage 2 progress through export and import', () => {
    const v2 = { schemaVersion: 2, currentMissionId: 'inc-packet', boards: {}, best: {}, questionHistory: [], conceptEvidence: [], settings: { reducedMotion: false }, incidents: { 'inc-packet': { actions: ['log:flow'], diagnosis: 'nacl:acl-app:outbound', verifiedAt: 'x' } }, diffAnswers: { 'diff-multiaz': { chosen: 'a', correct: true, at: 'x' } } };
    const s = validateImport(JSON.parse(JSON.stringify({ app: 'blast-radius', state: v2 })));
    expect(s.incidents['inc-packet'].diagnosis).toBe('nacl:acl-app:outbound');
    expect(s.diffAnswers['diff-multiaz'].correct).toBe(true);
  });
  it('rejects foreign or newer files', () => {
    expect(() => validateImport({ foo: 1 })).toThrow(/Not a Blast Radius/);
    expect(() => validateImport({ app: 'blast-radius', state: { schemaVersion: 99 } })).toThrow(/newer/);
  });
});

describe('Stage 4 saves (schema v3)', () => {
  const v2 = {
    schemaVersion: 2,
    currentMissionId: 'diff-multiaz',
    boards: {},
    best: { 'diff-multiaz': { stars: 3, points: 100, at: '2026-09-01T10:00:00.000Z' } },
    questionHistory: [
      { questionId: 'q-dr-1', chosen: ['a'], correct: true, at: '2026-09-02T10:00:00.000Z' },
      { questionId: 'q-dr-2', chosen: ['b'], correct: false, at: '2026-09-03T10:00:00.000Z' },
      { questionId: 'gone', chosen: ['a'], correct: true, at: '2026-09-03T10:00:00.000Z' },
    ],
    conceptEvidence: [],
    settings: { reducedMotion: false },
    incidents: {},
    diffAnswers: { 'diff-multiaz': { chosen: 'a', correct: true, at: '2026-09-01T10:00:00.000Z' } },
  };

  it('migrates v2 → v3, backfilling evidence from answers the save already holds', () => {
    const s = validateImport(JSON.parse(JSON.stringify({ app: 'blast-radius', state: v2 })));
    expect(s.schemaVersion).toBe(3);
    expect(s.daily).toEqual({});
    expect(s.defends).toEqual({});
    expect(s.exams).toEqual([]);
    // A player with progress skips the tour.
    expect(s.tutorial.done).toBe(true);
    const sources = new Set(s.conceptEvidence.map((e) => e.source));
    expect(sources).toEqual(new Set(['question:q-dr-1', 'question:q-dr-2', 'diff:diff-multiaz']));
    expect(s.conceptEvidence.find((e) => e.source === 'question:q-dr-2')!.correct).toBe(false);
  });

  it('keeps existing evidence instead of backfilling twice', () => {
    const ev = evidenceFor('event', 'portfolio/https', ['cloudfront-edge'], true, '2026-09-05T10:00:00.000Z');
    const s = validateImport({ app: 'blast-radius', state: { ...v2, conceptEvidence: ev } });
    expect(s.conceptEvidence).toEqual(ev);
  });

  it('a new player gets the tour', () => {
    const s = validateImport({ app: 'blast-radius', state: { ...v2, best: {}, boards: {}, questionHistory: [], diffAnswers: {} } });
    expect(s.tutorial).toEqual({ done: false, step: 0 });
  });

  it('export → import restores mastery and review schedules exactly', () => {
    const s = validateImport({ app: 'blast-radius', state: v2 });
    s.conceptEvidence = [...s.conceptEvidence, ...evidenceFor('defend', 'portfolio/https', ['cloudfront-oac'], true, '2026-09-06T10:00:00.000Z')];
    s.exams = [{ id: 'exam-1', startedAt: '2026-09-07T10:00:00.000Z', questionIds: ['q-dr-1'], answers: { 'q-dr-1': ['a'] }, flagged: [], finishedAt: '2026-09-07T11:00:00.000Z', score: { scaled: 1000, correct: 1, total: 1, pass: true, byDomain: {} } }];
    const back = validateImport(JSON.parse(JSON.stringify({ app: 'blast-radius', exportedAt: 'x', state: s })));
    expect(back).toEqual(s);
    const now = '2026-10-01T00:00:00.000Z';
    for (const c of CONCEPTS) {
      expect(mastery(back.conceptEvidence, c.id, now)).toEqual(mastery(s.conceptEvidence, c.id, now));
      expect(srsCard(back.conceptEvidence, c.id)).toEqual(srsCard(s.conceptEvidence, c.id));
    }
  });

  it('rejects a v3 file with malformed Stage 4 fields', () => {
    expect(() => validateImport({ app: 'blast-radius', state: { ...v2, schemaVersion: 3, daily: {}, defends: {}, exams: 'nope', tutorial: { done: true, step: 0 } } })).toThrow(/incomplete/);
  });
});
