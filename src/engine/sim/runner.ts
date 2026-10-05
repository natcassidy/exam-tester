import type { Board, EventKind, EventResult, EventSpec, Mission } from '../model';
import { audit } from './events/audit';
import { azOutage } from './events/azOutage';
import { bill } from './events/bill';
import { EventHandler, SimContext } from './events/context';
import { queueBehavior } from './events/queueBehavior';
import { reachability } from './events/reachability';
import { traffic } from './events/traffic';
import { iamAccess } from './events/iamAccess';
import { fleetHealth } from './events/fleetHealth';
import { regionOutage } from './events/regionOutage';
import { dataLoss } from './events/dataLoss';
import { migration } from './events/migration';
import { connectivity } from './events/connectivity';
import { globalLatency } from './events/globalLatency';
import { storageLifecycle } from './events/storageLifecycle';
import { streamIngest } from './events/streamIngest';
import { spotReclaim } from './events/spotReclaim';
import { commitment } from './events/commitment';

const HANDLERS: Record<EventKind, EventHandler> = {
  reachability,
  traffic,
  azOutage,
  audit,
  queueBehavior,
  bill,
  iamAccess,
  fleetHealth,
  regionOutage,
  dataLoss,
  migration,
  connectivity,
  globalLatency,
  storageLifecycle,
  streamIngest,
  spotReclaim,
  commitment,
};

export function runEvent(board: Board, ev: EventSpec, ctx: SimContext): EventResult {
  try {
    return HANDLERS[ev.kind](board, ev, ctx);
  } catch (e) {
    return { eventId: ev.id, status: 'fail', summary: `Simulation error: ${(e as Error).message}`, lesson: '', manual: ev.concepts, highlight: [] };
  }
}

export function runMission(board: Board, mission: Pick<Mission, 'events' | 'budget' | 'usage'>): EventResult[] {
  const ctx = { budget: mission.budget, usage: mission.usage };
  return mission.events.map((ev) => runEvent(board, ev, ctx));
}

/** Requirement → ticked when every linked event passes (warn counts as met). */
export function requirementStatus(mission: Mission, results: EventResult[]): Record<string, 'met' | 'missed'> {
  const out: Record<string, 'met' | 'missed'> = {};
  for (const req of mission.requirements) {
    const evs = mission.events.filter((e) => e.requirementIds?.includes(req.id));
    const ok = evs.every((e) => results.find((r) => r.eventId === e.id)?.status !== 'fail');
    out[req.id] = ok ? 'met' : 'missed';
  }
  return out;
}
