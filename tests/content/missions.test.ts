import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../../src/content/missions';
import { QUESTION_BY_ID, QUESTIONS } from '../../src/content/questions';
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

  it('references only concepts and questions that exist', () => {
    for (const c of mission.concepts) expect(CONCEPT_BY_ID[c], c).toBeDefined();
    for (const ev of mission.events) for (const c of ev.concepts) expect(CONCEPT_BY_ID[c], `${ev.id} → ${c}`).toBeDefined();
    for (const q of mission.questions) expect(QUESTION_BY_ID[q], q).toBeDefined();
    expect(mission.questions.length).toBeGreaterThanOrEqual(3);
    expect(mission.questions.length).toBeLessThanOrEqual(5);
  });

  it('every requirement is covered by an event', () => {
    for (const req of mission.requirements) expect(mission.events.some((e) => e.requirementIds?.includes(req.id)), req.id).toBe(true);
  });
});

describe('question bank', () => {
  it('has 20 Stage 1 questions with every option explained', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(20);
    for (const q of QUESTIONS) {
      for (const c of q.concepts) expect(CONCEPT_BY_ID[c], `${q.id} → ${c}`).toBeDefined();
      for (const o of q.options) expect(o.why.length, `${q.id}/${o.id}`).toBeGreaterThan(10);
      for (const c of q.correct) expect(q.options.some((o) => o.id === c), `${q.id} correct ${c}`).toBe(true);
    }
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });
});
