import { describe, expect, it } from 'vitest';
import { migrate, SCHEMA_VERSION, validateImport } from '../../src/store/schema';

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
    expect(s.schemaVersion).toBe(2);
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
