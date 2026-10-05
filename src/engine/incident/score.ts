// Incident scoring: root cause 50%, fix 30%, investigation actions 10%, no collateral 10%.
// Efficiency and restraint only count once the alert is actually fixed: doing nothing is not a tidy fix.

import type { Board, EventResult, Mission } from '../model';
import { Change, collateral } from './diff';

export interface IncidentScore {
  total: number;
  stars: 0 | 1 | 2 | 3;
  rootCause: { points: number; correct: boolean; picked: string | null };
  fix: { points: number; symptomFixed: boolean; allPass: boolean };
  actions: { points: number; used: number; par: number; budget: number };
  collateral: { points: number; changes: Change[] };
}

export function scoreIncident(mission: Mission, args: { diagnosis: string | null; results: EventResult[]; board: Board; actionsUsed: number }): IncidentScore {
  const inc = mission.incident!;
  const correct = args.diagnosis === inc.rootCause;
  const failed = new Set(args.results.filter((r) => r.status === 'fail').map((r) => r.eventId));
  const symptomFixed = inc.symptomEvents.every((e) => !failed.has(e));
  const allPass = failed.size === 0;
  const fixPts = allPass ? 30 : symptomFixed ? 15 : 0;
  const { budget, par } = inc;
  const used = args.actionsUsed;
  const actPts = !symptomFixed ? 0 : used <= par ? 10 : used >= budget ? 0 : Math.round((10 * (budget - used)) / (budget - par));
  const changes = collateral(mission.startingBoard!, args.board, inc.allowedChanges);
  const colPts = !symptomFixed ? 0 : changes.some((c) => c.danger) ? 0 : Math.max(0, 10 - 5 * changes.length);
  const total = (correct ? 50 : 0) + fixPts + actPts + colPts;
  const stars: IncidentScore['stars'] = total >= 90 ? 3 : total >= 70 ? 2 : total >= 40 ? 1 : 0;
  return {
    total,
    stars,
    rootCause: { points: correct ? 50 : 0, correct, picked: args.diagnosis },
    fix: { points: fixPts, symptomFixed, allPass },
    actions: { points: actPts, used, par, budget },
    collateral: { points: colPts, changes },
  };
}
