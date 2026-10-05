import { describe, expect, it } from 'vitest';
import { addEvidence, Evidence, evidenceFor, evidenceFromResults } from '../../src/engine/mastery/evidence';
import { intervalDays, isDue, srsCard } from '../../src/engine/mastery/srs';
import { mastery } from '../../src/engine/mastery/mastery';
import { buildDailySession, dueConcepts, streak } from '../../src/engine/mastery/daily';
import { domainCounts, drawExam, scaledScore, scoreExam } from '../../src/engine/mastery/exam';
import { CONCEPTS } from '../../src/content/concepts';
import { QUESTION_BY_ID, QUESTIONS } from '../../src/content/questions';
import { DIFFS, INCIDENTS } from '../../src/content/missions';

const day = (n: number, h = 12) => new Date(Date.UTC(2026, 0, 1 + n, h)).toISOString();
const ev = (correct: boolean, at: string, conceptId = 'nacls', source = `question:q-${at}`): Evidence => ({ conceptId, source, correct, weight: 1, at });

describe('spaced repetition (Leitner 1-2-4-8-16)', () => {
  it('uses the spec intervals', () => expect([1, 2, 3, 4, 5].map(intervalDays)).toEqual([1, 2, 4, 8, 16]));

  it('starts in box 1 and climbs one box per correct review once due', () => {
    let e: Evidence[] = [ev(true, day(0))];
    expect(srsCard(e, 'nacls')).toMatchObject({ box: 1, dueAt: day(1) });
    e = [...e, ev(true, day(1))];
    expect(srsCard(e, 'nacls')).toMatchObject({ box: 2, dueAt: day(3) });
    e = [...e, ev(true, day(3)), ev(true, day(7)), ev(true, day(15))];
    expect(srsCard(e, 'nacls')).toMatchObject({ box: 5, dueAt: day(31) });
    e = [...e, ev(true, day(31))];
    expect(srsCard(e, 'nacls').box).toBe(5);
  });

  it('does not promote a card that is not due yet (no cramming)', () => {
    const e = [ev(true, day(0)), ev(true, day(0, 13)), ev(true, day(0, 14))];
    expect(srsCard(e, 'nacls').box).toBe(1);
  });

  it('sends a card back to box 1 on a wrong answer', () => {
    const e = [ev(true, day(0)), ev(true, day(1)), ev(true, day(3)), ev(false, day(4))];
    expect(srsCard(e, 'nacls')).toMatchObject({ box: 1, dueAt: day(5) });
  });

  it('treats evidence recorded together as one review that is correct only if all of it is', () => {
    const e = [ev(true, day(0)), ev(true, day(1), 'nacls', 'event:a/x'), ev(false, day(1), 'nacls', 'event:a/y')];
    expect(srsCard(e, 'nacls').box).toBe(1);
  });

  it('knows when a card is due', () => {
    const c = srsCard([ev(true, day(0))], 'nacls');
    expect(isDue(c, day(0, 23))).toBe(false);
    expect(isDue(c, day(1))).toBe(true);
    expect(isDue(srsCard([], 'nacls'), day(5))).toBe(false);
  });
});

describe('mastery', () => {
  it('is weighted recent accuracy with a 50% prior', () => {
    expect(mastery([], 'nacls', day(0))).toMatchObject({ score: 0.5, level: 'new', count: 0 });
    const m = mastery([ev(true, day(0)), ev(true, day(0, 13)), ev(true, day(0, 14))], 'nacls', day(0, 14));
    expect(m.score).toBeCloseTo(3.5 / 4);
    expect(m.level).toBe('strong');
  });

  it('decays old evidence so recent results count more', () => {
    const e = [ev(false, day(0)), ev(true, day(60))];
    // The old miss is two half-lives old (weight 1/4): (0.5 + 1) / (1 + 1 + 0.25).
    expect(mastery(e, 'nacls', day(60)).score).toBeCloseTo(1.5 / 2.25);
  });

  it('weighs self-graded Defend evidence less than objective checks', () => {
    const at = day(0);
    const e = [...evidenceFor('defend', 'm/e', ['nacls'], true, at), ...evidenceFor('event', 'm/e', ['nacls'], false, at)];
    expect(mastery(e, 'nacls', at).score).toBeCloseTo((0.5 + 0.5) / (1 + 0.5 + 1));
  });
});

describe('evidence', () => {
  it('keeps the first answer of the day for questions and the last result for simulations', () => {
    let list = addEvidence([], evidenceFor('question', 'q1', ['nacls'], false, day(0)));
    list = addEvidence(list, evidenceFor('question', 'q1', ['nacls'], true, day(0, 15)));
    expect(list.map((e) => e.correct)).toEqual([false]);
    list = addEvidence(list, evidenceFor('question', 'q1', ['nacls'], true, day(1)));
    expect(list).toHaveLength(2);
    const r = (status: 'pass' | 'fail') => [{ eventId: 'x', status, summary: '', lesson: '', manual: [], highlight: [] }];
    const evs = [{ id: 'x', name: 'x', desc: '', domain: 'secure' as const, concepts: ['nacls'], kind: 'audit' as const, params: {} }];
    let sim = addEvidence([], evidenceFromResults('m', evs, r('fail'), day(0)));
    sim = addEvidence(sim, evidenceFromResults('m', evs, r('pass'), day(0, 18)));
    expect(sim).toHaveLength(1);
    expect(sim[0].correct).toBe(true);
  });
});

describe('daily session', () => {
  const input = (evidence: Evidence[], now: string) => ({
    evidence,
    now,
    questionHistory: [],
    concepts: CONCEPTS,
    questions: QUESTIONS,
    diffs: DIFFS.map((m) => ({ id: m.id, concepts: m.concepts })),
    incidents: INCIDENTS.map((m) => ({ id: m.id, concepts: m.concepts })),
  });

  it('is deterministic for the same state and date', () => {
    const e = [ev(false, day(0), 'nacls'), ev(true, day(0), 'rds-multi-az')];
    expect(buildDailySession(input(e, day(2)))).toEqual(buildDailySession(input(e, day(2))));
  });

  it('puts due concepts first, weakest first, and fills with new ones', () => {
    const e = [ev(true, day(0), 'rds-multi-az'), ev(false, day(0), 'nacls'), ev(true, day(0), 'sqs-dlq'), ev(true, day(0, 13), 'sqs-dlq', 'question:other')];
    const plan = buildDailySession(input(e, day(2)));
    expect(plan.focus.slice(0, 3)).toEqual(['nacls', 'rds-multi-az', 'sqs-dlq']);
    expect(plan.reasons.nacls).toBe('due');
    expect(plan.reasons[plan.focus[3]]).toBe('new');
    expect(dueConcepts(e, CONCEPTS.map((c) => c.id), day(2))).toEqual(['nacls', 'rds-multi-az', 'sqs-dlq']);
  });

  it('mixes 5 transfer questions about the focus, a Spot the Difference round and a mini-incident', () => {
    const plan = buildDailySession(input([ev(false, day(0), 'nacls')], day(2)));
    expect(plan.items.filter((i) => i.kind === 'question')).toHaveLength(5);
    expect(plan.items.filter((i) => i.kind === 'diff')).toHaveLength(1);
    expect(plan.items.filter((i) => i.kind === 'incident')).toHaveLength(1);
    const qs = plan.items.flatMap((i) => (i.kind === 'question' ? [QUESTION_BY_ID[i.questionId]] : []));
    expect(qs[0].concepts).toContain('nacls');
    expect(new Set(qs.map((q) => q.id)).size).toBe(5);
    const inc = plan.items.find((i) => i.kind === 'incident')!;
    expect(INCIDENTS.find((m) => m.id === (inc as { missionId: string }).missionId)!.concepts).toContain('nacls');
  });

  it('counts a streak of consecutive completed days', () => {
    expect(streak(['2026-01-01', '2026-01-02', '2026-01-03'], '2026-01-03')).toBe(3);
    expect(streak(['2026-01-01', '2026-01-02'], '2026-01-03')).toBe(2);
    expect(streak(['2026-01-01'], '2026-01-03')).toBe(0);
  });
});

describe('exam mode', () => {
  it('draws 65 questions weighted 30/26/24/20 and never repeats one', () => {
    expect(domainCounts(65)).toEqual({ secure: 19, resilient: 17, performant: 16, cost: 13 });
    for (const seed of ['a', 'b', 'exam-2026-01-01T00:00:00.000Z']) {
      const ids = drawExam(QUESTIONS, seed);
      expect(ids).toHaveLength(65);
      expect(new Set(ids).size).toBe(65);
      const by = { secure: 0, resilient: 0, performant: 0, cost: 0 };
      for (const id of ids) by[QUESTION_BY_ID[id].domain]++;
      expect(by).toEqual(domainCounts(65));
    }
    expect(drawExam(QUESTIONS, 'same')).toEqual(drawExam(QUESTIONS, 'same'));
    expect(drawExam(QUESTIONS, 'one')).not.toEqual(drawExam(QUESTIONS, 'two'));
  });

  it('scores on the 100-1000 scale with a pass at 720', () => {
    expect(scaledScore(0)).toBe(100);
    expect(scaledScore(1)).toBe(1000);
    const ids = drawExam(QUESTIONS, 'x');
    const all = Object.fromEntries(ids.map((id) => [id, QUESTION_BY_ID[id].correct]));
    expect(scoreExam(ids, QUESTION_BY_ID, all)).toMatchObject({ correct: 65, scaled: 1000, pass: true });
    const none = scoreExam(ids, QUESTION_BY_ID, {});
    expect(none.pass).toBe(false);
    expect(none.byDomain.secure.total).toBe(19);
  });
});
