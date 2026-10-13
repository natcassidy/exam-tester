import { describe, expect, it } from 'vitest';
import { MISSIONS, REFACTORS, INCIDENTS, DIFFS } from '../../src/content/missions';
import { MANUAL } from '../../src/content/manual';
import { createBoardFromLayout, placeComponent, validatePlacement } from '../../src/engine/board';
import type { Board, Mission, Placement, ServiceType } from '../../src/engine/model';
import { runMission } from '../../src/engine/sim/runner';
import { buildDebrief } from '../../src/engine/assist/debrief';
import { missionPalette } from '../../src/engine/palette';

const PLAYABLE = [...MISSIONS, ...REFACTORS];

/** Every zone on a board, so a test can find somewhere a service is allowed to go. */
function zones(b: Board): Placement[] {
  const out: Placement[] = [{ kind: 'edge', refId: 'global' }];
  if (b.onprem) out.push({ kind: 'onprem', refId: 'onprem' });
  for (const r of b.regions) {
    out.push({ kind: 'region', refId: r.id });
    for (const v of r.vpcs) {
      out.push({ kind: 'vpcAttach', refId: v.id });
      for (const az of v.azs) for (const s of az.subnets) out.push({ kind: 'subnet', refId: s.id });
    }
  }
  return out;
}
const zoneFor = (b: Board, t: ServiceType, m: Mission) => zones(b).find((z) => !validatePlacement(b, t, z) && placeComponent(b, t, z, m.defaults).ok);

describe.each(PLAYABLE.map((m) => [m.id, m] as const))('solution review for %s', (_id, m: Mission) => {
  const refTypes = new Set(Object.values(m.reference.components).map((c) => c.type));
  const refNames = new Set([...Object.values(m.reference.components).map((c) => c.name), ...Object.values(m.reference.routeTables).map((rt) => rt.name)]);

  it('has key decisions that point at real events, components and manual entries', () => {
    expect(m.decisions?.length ?? 0).toBeGreaterThanOrEqual(3);
    for (const d of m.decisions!) {
      expect(d.events.length, d.title).toBeGreaterThan(0);
      for (const e of d.events) expect(m.events.map((x) => x.id), `${d.title}: ${e}`).toContain(e);
      for (const c of d.components ?? []) expect(refNames.has(c), `${d.title}: ${c}`).toBe(true);
      for (const id of d.manual ?? []) expect(MANUAL[id], `${d.title}: ${id}`).toBeTruthy();
    }
  });

  it('every event the reference passes is explained by a decision (bill events aside)', () => {
    const explained = new Set(m.decisions!.flatMap((d) => d.events));
    for (const ev of m.events) if (ev.kind !== 'bill') expect(explained.has(ev.id), ev.id).toBe(true);
  });

  it('hard mode adds placeable distractors the reference does not use', () => {
    const easy = missionPalette(m, 'easy');
    const hard = missionPalette(m, 'hard');
    expect(m.distractors!.length).toBeGreaterThanOrEqual(4);
    expect(hard.length).toBe(easy.length + m.distractors!.length);
    const board = createBoardFromLayout(m.layout);
    for (const t of m.distractors!) {
      expect(easy, t).not.toContain(t);
      expect(refTypes.has(t), t).toBe(false);
      expect(zoneFor(board, t, m), `${t} has nowhere to go on this board`).toBeTruthy();
    }
  });

  it('explains every offered service the reference leaves out', () => {
    for (const t of missionPalette(m, 'hard')) if (!refTypes.has(t)) expect(m.whyNot?.[t], t).toBeTruthy();
  });

  it('a distractor dropped on the reference board breaks nothing and shows up with its note', () => {
    for (const t of m.distractors!) {
      const zone = zoneFor(m.reference, t, m)!;
      const r = placeComponent(m.reference, t, zone, m.defaults);
      expect(r.ok, t).toBe(true);
      if (!r.ok) continue;
      const results = runMission(r.board, m);
      const db = buildDebrief(m, r.board, results);
      expect(db.extras.map((x) => x.type)).toEqual([t]);
      expect(db.extras[0].note).toBe(m.whyNot![t]);
      expect(Object.values(db.playerMarks)).toContain('extra');
    }
  });

  it('the reference covers every decision with no differences', () => {
    const db = buildDebrief(m, m.reference, runMission(m.reference, m));
    expect(db.allPass).toBe(true);
    expect(db.decisions.every((d) => d.status === 'covered')).toBe(true);
    expect(db.other).toEqual([]);
    expect(db.extras).toEqual([]);
  });

  it.each(m.mistakes.map((x) => [x.name, x] as const))('mistake "%s" misses the decisions behind its failures', (_n, mistake) => {
    const results = runMission(mistake.board, m);
    const db = buildDebrief(m, mistake.board, results);
    const missed = db.decisions.filter((d) => d.status === 'missed');
    expect(missed.length).toBeGreaterThan(0);
    for (const e of mistake.expectFail) {
      if (m.events.find((x) => x.id === e)?.kind === 'bill') continue;
      expect(missed.some((d) => d.decision.events.includes(e)), e).toBe(true);
    }
    // Each missed decision points at what differs, and every difference has a decision to explain it.
    for (const d of missed) expect(d.diffs.length, d.decision.title).toBeGreaterThan(0);
    expect(db.other.map((d) => d.text)).toEqual([]);
  });
});

describe('hard mode', () => {
  it('leaves incidents and Spot the Difference rounds alone', () => {
    for (const m of [...INCIDENTS, ...DIFFS]) expect(missionPalette(m, 'hard')).toEqual(missionPalette(m, 'easy'));
  });
});
