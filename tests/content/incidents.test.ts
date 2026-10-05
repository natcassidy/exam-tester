import { describe, expect, it } from 'vitest';
import { INCIDENTS } from '../../src/content/incidents';
import { runMission } from '../../src/engine/sim/runner';
import { scoreResults } from '../../src/engine/scoring';
import { collateral, diffBoards } from '../../src/engine/incident/diff';
import { listSuspects } from '../../src/engine/incident/suspects';
import { scoreIncident } from '../../src/engine/incident/score';

const summarize = (rs: ReturnType<typeof runMission>) => rs.map((r) => `${r.eventId}: ${r.status} — ${r.summary}`).join('\n');
const failing = (rs: ReturnType<typeof runMission>) => rs.filter((r) => r.status === 'fail').map((r) => r.eventId).sort();

describe.each(INCIDENTS.map((m) => [m.id, m] as const))('incident %s', (_id, mission) => {
  const inc = mission.incident!;
  const start = mission.startingBoard!;

  it('the starting board fails with exactly the stated symptom', () => {
    const rs = runMission(start, mission);
    expect(failing(rs), summarize(rs)).toEqual([...inc.symptomEvents].sort());
  });

  it('the reference fix passes every event (3 stars) with no collateral changes', () => {
    const rs = runMission(mission.reference, mission);
    expect(failing(rs), summarize(rs)).toEqual([]);
    expect(scoreResults(mission.events, rs).stars).toBe(3);
    expect(diffBoards(start, mission.reference).length).toBeGreaterThan(0);
    expect(collateral(start, mission.reference, inc.allowedChanges)).toEqual([]);
  });

  it('the root cause is something the player can point at', () => {
    expect(listSuspects(start).map((s) => s.id)).toContain(inc.rootCause);
  });

  it('a perfect investigation scores 100', () => {
    const rs = runMission(mission.reference, mission);
    const s = scoreIncident(mission, { diagnosis: inc.rootCause, results: rs, board: mission.reference, actionsUsed: inc.par });
    expect(s.total).toBe(100);
  });

  it('changing nothing earns no fix, investigation or collateral points', () => {
    const rs = runMission(start, mission);
    const s = scoreIncident(mission, { diagnosis: inc.rootCause, results: rs, board: start, actionsUsed: 0 });
    expect(s.total).toBe(50);
    expect(scoreIncident(mission, { diagnosis: null, results: rs, board: start, actionsUsed: 0 }).total).toBe(0);
  });

  it('has at least one plausible wrong fix', () => expect(inc.wrongFixes.length).toBeGreaterThanOrEqual(1));

  it.each(inc.wrongFixes.map((w) => [w.name, w] as const))('wrong fix "%s" fails or is flagged as collateral', (_n, w) => {
    const rs = runMission(w.board, mission);
    expect(failing(rs), summarize(rs)).toEqual([...w.expectFail].sort());
    const col = collateral(start, w.board, inc.allowedChanges);
    expect(col.length > 0, JSON.stringify(col)).toBe(w.collateral);
    expect(w.expectFail.length > 0 || w.collateral).toBe(true);
    const s = scoreIncident(mission, { diagnosis: inc.rootCause, results: rs, board: w.board, actionsUsed: inc.par });
    expect(s.total).toBeLessThan(100);
  });

  it('has logs to investigate and a sane budget', () => {
    expect(inc.logs.length).toBeGreaterThan(0);
    expect(inc.par).toBeLessThan(inc.budget);
  });
});
