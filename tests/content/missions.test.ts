import { describe, expect, it } from 'vitest';
import { ALL_MISSIONS, DIFFS, MISSIONS } from '../../src/content/missions';
import { QUESTION_BY_ID, QUESTIONS } from '../../src/content/questions';
import { TASKS } from '../../src/content/concepts';
import { DOMAIN_ORDER, DOMAIN_WEIGHTS } from '../../src/engine/mastery/exam';
import { CONCEPT_BY_ID } from '../../src/content/concepts';
import { createBoardFromLayout } from '../../src/engine/board';
import { runMission } from '../../src/engine/sim/runner';
import { scoreResults } from '../../src/engine/scoring';

const summarize = (rs: ReturnType<typeof runMission>) => rs.map((r) => `${r.eventId}: ${r.status} — ${r.summary}`).join('\n');

describe.each(MISSIONS.map((m) => [m.id, m] as const))('mission %s', (_id, mission) => {
  it('reference board passes every event (3 stars)', () => {
    const results = runMission(mission.reference, mission);
    const failed = results.filter((r) => r.status !== 'pass');
    expect(failed, summarize(results)).toEqual([]);
    expect(scoreResults(mission.events, results).stars).toBe(3);
  });

  it('empty board fails every event except ones marked otherwise', () => {
    const results = runMission(createBoardFromLayout(mission.layout), mission);
    for (const ev of mission.events) {
      const r = results.find((x) => x.eventId === ev.id)!;
      if (ev.passesOnEmptyBoard) expect(r.status, `${ev.id}: ${r.summary}`).not.toBe('fail');
      else expect(r.status, `${ev.id}: ${r.summary}`).toBe('fail');
    }
  });

  it.each(mission.mistakes.map((m) => [m.name, m] as const))('mistake "%s" fails exactly its expected events', (_n, mistake) => {
    const results = runMission(mistake.board, mission);
    const failing = results.filter((r) => r.status === 'fail').map((r) => r.eventId).sort();
    expect(failing, summarize(results)).toEqual([...mistake.expectFail].sort());
  });

  it('has at least 3 mistakes', () => expect(mission.mistakes.length).toBeGreaterThanOrEqual(3));

});

describe.each(ALL_MISSIONS.map((m) => [m.id, m] as const))('content of %s', (_id, mission) => {
  it('references only concepts and questions that exist', () => {
    for (const c of mission.concepts) expect(CONCEPT_BY_ID[c], c).toBeDefined();
    for (const ev of mission.events) for (const c of ev.concepts) expect(CONCEPT_BY_ID[c], `${ev.id} → ${c}`).toBeDefined();
    for (const q of mission.questions) expect(QUESTION_BY_ID[q], q).toBeDefined();
    const [min, max] = mission.mode === 'diff' ? [2, 3] : [3, 5];
    expect(mission.questions.length).toBeGreaterThanOrEqual(min);
    expect(mission.questions.length).toBeLessThanOrEqual(max);
  });

  it('every requirement is covered by an event', () => {
    for (const req of mission.requirements) expect(mission.events.some((e) => e.requirementIds?.includes(req.id)), req.id).toBe(true);
  });

  it('has a unique id', () => expect(ALL_MISSIONS.filter((m) => m.id === mission.id)).toHaveLength(1));
});

describe('question bank', () => {
  it('has 150+ questions with every option explained', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(150);
    for (const q of QUESTIONS) {
      for (const c of q.concepts) expect(CONCEPT_BY_ID[c], `${q.id} → ${c}`).toBeDefined();
      for (const o of q.options) expect(o.why.length, `${q.id}/${o.id}`).toBeGreaterThan(10);
      for (const c of q.correct) expect(q.options.some((o) => o.id === c), `${q.id} correct ${c}`).toBe(true);
    }
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });

  it('is balanced like the exam: each domain within 2 points of its SAA-C03 weight', () => {
    for (const d of DOMAIN_ORDER) {
      const share = QUESTIONS.filter((q) => q.domain === d).length / QUESTIONS.length;
      expect(Math.abs(share - DOMAIN_WEIGHTS[d]), `${d}: ${(share * 100).toFixed(1)}%`).toBeLessThanOrEqual(0.02);
    }
  });

  it('every concept has at least one question (so "Practice this" always works)', () => {
    for (const c of Object.values(CONCEPT_BY_ID)) expect(QUESTIONS.some((q) => q.concepts.includes(c.id)), c.id).toBe(true);
  });

  it("doesn't give the answer away by length", () => {
    // The answer used to be the longest option in 3 of 4 questions; picking the longest scored ~75%.
    const len = (q: (typeof QUESTIONS)[number], ids: string[]) => q.options.filter((o) => ids.includes(o.id)).map((o) => o.text.length);
    const single = QUESTIONS.filter((q) => q.correct.length === 1);
    for (const q of single) {
      const wrong = q.options.filter((o) => !q.correct.includes(o.id)).map((o) => o.id);
      expect(len(q, q.correct)[0] / Math.max(...len(q, wrong)), `${q.id}: answer much longer than every distractor`).toBeLessThanOrEqual(1.2);
    }
    const longest = single.filter((q) => len(q, q.correct)[0] > Math.max(...len(q, q.options.map((o) => o.id).filter((id) => !q.correct.includes(id)))));
    expect(longest.length / single.length, 'share of questions whose answer is the longest option').toBeLessThanOrEqual(0.35);
    for (const q of QUESTIONS.filter((x) => x.correct.length > 1)) {
      const top = [...q.options].sort((a, b) => b.text.length - a.text.length).slice(0, q.correct.length);
      expect(top.every((o) => q.correct.includes(o.id)), `${q.id}: the answers are exactly the longest options`).toBe(false);
    }
    for (const m of DIFFS) {
      const d = m.diff!;
      const answer = d.options.find((o) => o.id === d.correct)!.text.length;
      expect(answer / Math.max(...d.options.filter((o) => o.id !== d.correct).map((o) => o.text.length)), m.id).toBeLessThanOrEqual(1.2);
    }
  });

  it('multi-answer questions say how many to choose', () => {
    for (const q of QUESTIONS.filter((x) => x.correct.length > 1)) expect(q.stem, q.id).toMatch(/\((Choose|Select) (TWO|THREE)\.?\)/i);
  });
});

describe('concepts', () => {
  it("each concept's domain matches its exam task statement", () => {
    for (const c of Object.values(CONCEPT_BY_ID)) {
      const task = TASKS.find((t) => t.id === c.task);
      expect(task, `${c.id} → task ${c.task}`).toBeDefined();
      expect(task!.domain, c.id).toBe(c.domain);
    }
  });
});

import { MANUAL } from '../../src/content/manual';
import { CONCEPTS } from '../../src/content/concepts';

describe('field manual', () => {
  it('has an entry for every concept with the required sections', () => {
    for (const c of CONCEPTS) {
      const body = MANUAL[c.id];
      expect(body, c.id).toBeDefined();
      expect(body, c.id).toMatch(/## What it is/);
      expect(body, c.id).toMatch(/## How it actually works/);
      expect(body, c.id).toMatch(/## Common exam traps/);
      expect(body, c.id).toMatch(/## Related/);
      for (const [, ref] of body.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) expect(MANUAL[ref], `${c.id} → ${ref}`).toBeDefined();
    }
  });
});
