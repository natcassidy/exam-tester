import { describe, expect, it } from 'vitest';
import { REFACTORS } from '../../src/content/missions';
import { rightSizeDb, rightSizeDbAurora } from '../../src/content/missions/refactors';
import { runMission } from '../../src/engine/sim/runner';
import { scoreRefactor } from '../../src/engine/scoring';
import { SURPRISES } from '../../src/content/surprises';
import { pickSurprise } from '../../src/engine/mastery/surprise';
import { MISSIONS } from '../../src/content/missions';
import { DEFENDS } from '../../src/content/defend';
import { MISSION_BY_ID } from '../../src/content/missions';

const summarize = (rs: ReturnType<typeof runMission>) => rs.map((r) => `${r.eventId}: ${r.status} — ${r.summary}`).join('\n');

describe.each(REFACTORS.map((m) => [m.id, m] as const))('refactor %s', (_id, m) => {
  const start = runMission(m.startingBoard!, m);
  const ref = runMission(m.reference, m);

  it('is a stage 4 refactor with a requirement change and a starting board', () => {
    expect(m.mode).toBe('refactor');
    expect(m.stage).toBe(4);
    expect(m.refactor?.change.length).toBeGreaterThan(20);
    expect(m.startingBoard).toBeDefined();
  });

  it('the starting board works but misses the new requirements', () => {
    expect(start.some((r) => r.status === 'fail'), summarize(start)).toBe(true);
  });

  it('the reference meets every requirement and scores 3 stars and 100 points', () => {
    expect(ref.filter((r) => r.status !== 'pass'), summarize(ref)).toEqual([]);
    const s = scoreRefactor(m, ref, start, ref);
    expect(s).toMatchObject({ stars: 3, points: 100, allPass: true });
    expect(s.cost).toBeLessThan(s.startCost);
  });

  it('the starting board scores no stars', () => expect(scoreRefactor(m, start, start, ref).stars).toBe(0));

  it.each(m.mistakes.map((x) => [x.name, x] as const))('mistake "%s" fails exactly its expected events', (_n, x) => {
    const rs = runMission(x.board, m);
    expect(rs.filter((r) => r.status === 'fail').map((r) => r.eventId).sort(), summarize(rs)).toEqual([...x.expectFail].sort());
  });

  it('has at least 3 mistakes', () => expect(m.mistakes.length).toBeGreaterThanOrEqual(3));
});

describe('refactor scoring', () => {
  it('accepts Aurora Serverless v2 as another right-sized database', () => {
    const rs = runMission(rightSizeDbAurora, rightSizeDb);
    expect(rs.filter((r) => r.status !== 'pass'), summarize(rs)).toEqual([]);
    const s = scoreRefactor(rightSizeDb, rs, runMission(rightSizeDb.startingBoard!, rightSizeDb), runMission(rightSizeDb.reference, rightSizeDb));
    expect(s.stars).toBeGreaterThanOrEqual(2);
  });

  it('gives fewer points for a design that meets everything but saves less', () => {
    const m = REFACTORS[0];
    const start = runMission(m.startingBoard!, m);
    const ref = runMission(m.reference, m);
    const fake = ref.map((r) => (r.eventId === 'bill' ? { ...r, metrics: { ...r.metrics, monthly: (r.metrics!.monthly + start.find((x) => x.eventId === 'bill')!.metrics!.monthly) / 2 } } : r));
    const s = scoreRefactor(m, fake, start, ref);
    expect(s.allPass).toBe(true);
    expect(s.points).toBe(80);
    expect(s.stars).toBe(2);
  });
});

describe('surprise incidents', () => {
  it('only offers surprises the mission reference survives, for a due concept', () => {
    const ledgerly = MISSION_BY_ID.ledgerly;
    const ev = pickSurprise(ledgerly, ['nacls'], SURPRISES);
    expect(ev?.id).toBe('surprise-ephemeral');
    expect(pickSurprise(MISSION_BY_ID.dropshop, ['nacls'], SURPRISES)).toBeNull();
    expect(pickSurprise(MISSION_BY_ID.dropshop, ['encryption-at-rest'], SURPRISES)).toBeNull(); // already an event there
  });

  it('every surprise applies to at least one build mission', () => {
    for (const s of SURPRISES) expect(MISSIONS.some((m) => pickSurprise(m, s.concepts.slice(0, 1), [s])), s.id).toBe(true);
  });
});

describe('defend rounds', () => {
  it('reference real events and have a 3-4 point rubric', () => {
    expect(Object.keys(DEFENDS).length).toBeGreaterThanOrEqual(12);
    for (const [key, d] of Object.entries(DEFENDS)) {
      const [mid, eid] = key.split('/');
      expect(MISSION_BY_ID[mid]?.events.some((e) => e.id === eid), key).toBe(true);
      expect(d.rubric.length, key).toBeGreaterThanOrEqual(3);
      expect(d.rubric.length, key).toBeLessThanOrEqual(4);
      expect(d.model.length, key).toBeGreaterThan(40);
    }
  });
});
