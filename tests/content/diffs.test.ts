import { describe, expect, it } from 'vitest';
import { DIFFS } from '../../src/content/diffs';
import { runMission } from '../../src/engine/sim/runner';
import { diffBoards } from '../../src/engine/incident/diff';

describe.each(DIFFS.map((m) => [m.id, m] as const))('spot the difference %s', (_id, mission) => {
  const d = mission.diff!;
  it('runs one event: the survivor passes and the other side fails', () => {
    expect(mission.events).toHaveLength(1);
    const left = runMission(d.left, mission)[0];
    const right = runMission(d.right, mission)[0];
    const [win, lose] = d.survivor === 'left' ? [left, right] : [right, left];
    expect(win.status, win.summary).toBe('pass');
    expect(lose.status, lose.summary).toBe('fail');
  });

  it('options are built from real differences and cover all of them', () => {
    const keys = diffBoards(d.left, d.right).map((c) => c.key).sort();
    const optionKeys = d.options.flatMap((o) => o.changes).sort();
    expect(optionKeys).toEqual(keys);
    expect(d.options.some((o) => o.id === d.correct)).toBe(true);
    for (const o of d.options) expect(o.why.length).toBeGreaterThan(20);
  });
});
