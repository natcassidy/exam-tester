import { describe, expect, it } from 'vitest';
import { migrate, SCHEMA_VERSION, validateImport } from '../../src/store/schema';

describe('progress files', () => {
  it('round-trips and migrates old saves', () => {
    const state = { schemaVersion: 0, currentMissionId: 'ledgerly', boards: {}, best: { ledgerly: { stars: 3, points: 100, at: 'x' } }, questionHistory: [] };
    const s = validateImport({ app: 'blast-radius', state });
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.conceptEvidence).toEqual([]);
    expect(s.best.ledgerly.stars).toBe(3);
    expect(migrate(s, SCHEMA_VERSION)).toEqual(s);
  });
  it('rejects foreign or newer files', () => {
    expect(() => validateImport({ foo: 1 })).toThrow(/Not a Blast Radius/);
    expect(() => validateImport({ app: 'blast-radius', state: { schemaVersion: 99 } })).toThrow(/newer/);
  });
});
