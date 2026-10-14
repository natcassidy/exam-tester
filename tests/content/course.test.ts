import { describe, expect, it } from 'vitest';
import { COURSE, COURSE_SECTIONS } from '../../src/content/course';
import { HANDED_OVER } from '../../src/content/course/helpers';
import { createBoardFromLayout } from '../../src/engine/board';
import { runMission } from '../../src/engine/sim/runner';
import { scoreResults } from '../../src/engine/scoring';

const summarize = (rs: ReturnType<typeof runMission>) => rs.map((r) => `${r.eventId}: ${r.status} — ${r.summary}`).join('\n');

describe.each(COURSE.map((m) => [m.id, m] as const))('course lab %s', (_id, lab) => {
  it('reference board passes every event (3 stars)', () => {
    const results = runMission(lab.reference, lab);
    expect(results.filter((r) => r.status !== 'pass'), summarize(results)).toEqual([]);
    expect(scoreResults(lab.events, results).stars).toBe(3);
  });

  it('empty layout fails every event except ones marked otherwise', () => {
    const results = runMission(createBoardFromLayout(lab.layout), lab);
    for (const ev of lab.events) {
      const r = results.find((x) => x.eventId === ev.id)!;
      if (ev.passesOnEmptyBoard) expect(r.status, `${ev.id}: ${r.summary}`).not.toBe('fail');
      else expect(r.status, `${ev.id}: ${r.summary}`).toBe('fail');
    }
  });

  it.each(lab.mistakes.map((m) => [m.name, m] as const))('"%s" fails exactly its expected events', (_n, mistake) => {
    const results = runMission(mistake.board, lab);
    const failing = results.filter((r) => r.status === 'fail').map((r) => r.eventId).sort();
    expect(failing, summarize(results)).toEqual([...mistake.expectFail].sort());
  });

  it('matches its kind: fix and finish labs start from a board that fails, build labs from nothing', () => {
    const c = lab.course!;
    if (c.kind === 'build') expect(lab.startingBoard).toBeUndefined();
    else {
      expect(lab.startingBoard).toBeDefined();
      expect(lab.mistakes[0].name).toBe(HANDED_OVER);
      expect(lab.mistakes[0].expectFail.length).toBeGreaterThan(0);
    }
    expect(lab.mistakes.length).toBeGreaterThanOrEqual(c.kind === 'build' ? 2 : 3);
    expect(c.lectures.length).toBeGreaterThan(0);
  });

  it('belongs to a section that has labs', () => {
    const s = COURSE_SECTIONS.find((x) => x.n === lab.course!.section);
    expect(s).toBeDefined();
    expect(s!.skip).toBeUndefined();
  });
});

describe('course sections', () => {
  it('every section without a skip reason has 1-3 labs, and skipped sections have none', () => {
    for (const s of COURSE_SECTIONS) {
      const n = COURSE.filter((m) => m.course!.section === s.n).length;
      if (s.skip) expect(n, `section ${s.n}`).toBe(0);
      else {
        expect(n, `section ${s.n}`).toBeGreaterThanOrEqual(1);
        expect(n, `section ${s.n}`).toBeLessThanOrEqual(3);
      }
    }
  });

  it('mixes fix, finish and build labs', () => {
    for (const k of ['fix', 'finish', 'build'] as const) expect(COURSE.filter((m) => m.course!.kind === k).length, k).toBeGreaterThanOrEqual(5);
  });
});
