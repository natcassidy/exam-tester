import type { Domain, EventResult, EventSpec } from './model';

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
