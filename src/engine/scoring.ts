import type { Domain, EventResult, EventSpec, Mission } from './model';

export interface Score {
  stars: 0 | 1 | 2 | 3;
  passed: number;
  warned: number;
  failed: number;
  total: number;
  points: number; // 0-100
  domains: Partial<Record<Domain, { earned: number; total: number }>>;
}

/**
 * 3 stars: every event passes. 2: nothing fails (some warnings). 1: at least half pass. 0 otherwise.
 * Points: pass = 1, warn = 0.5, fail = 0.
 */
export function scoreResults(events: EventSpec[], results: EventResult[]): Score {
  const domains: Score['domains'] = {};
  let passed = 0, warned = 0, failed = 0, earned = 0;
  for (const ev of events) {
    const r = results.find((x) => x.eventId === ev.id);
    const v = r?.status === 'pass' ? 1 : r?.status === 'warn' ? 0.5 : 0;
    if (r?.status === 'pass') passed++;
    else if (r?.status === 'warn') warned++;
    else failed++;
    earned += v;
    const d = (domains[ev.domain] ??= { earned: 0, total: 0 });
    d.earned += v;
    d.total += 1;
  }
  const total = events.length;
  const stars: Score['stars'] = total && passed === total ? 3 : total && failed === 0 ? 2 : passed * 2 >= total && total ? 1 : 0;
  return { stars, passed, warned, failed, total, points: total ? Math.round((earned / total) * 100) : 0, domains };
}

// ---------- Refactor missions (Stage 4) ----------

export interface RefactorScore {
  stars: 0 | 1 | 2 | 3;
  points: number;
  allPass: boolean;
  passed: number;
  total: number;
  /** Monthly cost of the design being scored, the starting board, and the reference design. */
  cost: number;
  startCost: number;
  targetCost: number;
  /** Share of the possible saving achieved (0..1). */
  savingsRatio: number;
}

/** Monthly cost a refactor optimises: its cost events' `metrics.monthly`, summed. */
export function refactorCost(m: Pick<Mission, 'events' | 'refactor'>, results: EventResult[]): number {
  const ids = m.refactor?.costEvents ?? m.events.filter((e) => e.kind === 'bill').map((e) => e.id);
  return Math.round(ids.reduce((s, id) => s + (results.find((r) => r.eventId === id)?.metrics?.monthly ?? 0), 0) * 100) / 100;
}

/**
 * Refactors score on meeting every requirement at the lowest cost.
 * Requirements: up to 60 points (pass 1, warn ½ per event). Savings: up to 40 points, only when every
 * requirement is met, for the share of the saving from the starting cost to the reference cost.
 * 3 stars: everything met and ≥ 95 points. 2: everything met and at least half the saving. 1: everything met.
 */
export function scoreRefactor(m: Pick<Mission, 'events' | 'refactor'>, results: EventResult[], startResults: EventResult[], refResults: EventResult[]): RefactorScore {
  const base = scoreResults(m.events, results);
  const allPass = base.passed === base.total && base.total > 0;
  const cost = refactorCost(m, results);
  const startCost = refactorCost(m, startResults);
  const targetCost = refactorCost(m, refResults);
  const span = startCost - targetCost;
  const savingsRatio = span > 0 ? Math.max(0, Math.min(1, (startCost - cost) / span)) : cost <= targetCost ? 1 : 0;
  const reqPoints = base.total ? (60 * (base.passed + base.warned / 2)) / base.total : 0;
  const points = Math.round(reqPoints + (allPass ? 40 * savingsRatio : 0));
  const stars: RefactorScore['stars'] = !allPass ? 0 : points >= 95 ? 3 : savingsRatio >= 0.5 ? 2 : 1;
  return { stars, points, allPass, passed: base.passed, total: base.total, cost, startCost, targetCost, savingsRatio };
}
