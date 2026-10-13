// The end-of-mission solution review: the reference design's key decisions next to the player's
// design. A decision is "covered" when the player's design passes the events that prove it, even if
// it gets there another way; the differences from the reference are listed under the decision they
// belong to, and each service the player used that the reference doesn't gets a "why not".

import type { Board, DesignDecision, EventResult, Mission, ServiceType } from '../model';
import { compareToReference, referencePairs, type RefDifference } from './compare';

/**
 * covered: every event behind the decision passes. missed: one fails and the player's board differs
 * from the reference on this decision (or nothing else explains the failure). same: one fails, but
 * the board matches the reference here and another decision's difference explains it.
 */
export type DecisionStatus = 'covered' | 'missed' | 'same' | 'untested';

export interface DecisionReview {
  decision: DesignDecision;
  status: DecisionStatus;
  /** Names of the decision's events the player's design fails. */
  failing: string[];
  diffs: RefDifference[];
}

export interface ExtraService {
  type: ServiceType;
  names: string[];
  note?: string;
}

export interface Debrief {
  decisions: DecisionReview[];
  /** Differences no decision claims. */
  other: RefDifference[];
  /** Services on the player's board that the reference doesn't use at all. */
  extras: ExtraService[];
  /** Marks for drawing both boards: component id → how it differs. */
  playerMarks: Record<string, 'extra' | 'changed'>;
  refMarks: Record<string, 'missing' | 'changed'>;
  /** Every event passed. */
  allPass: boolean;
}

/** The decision a difference belongs to: the most specific match wins, -1 for none. */
function owner(d: RefDifference, decisions: DesignDecision[]): number {
  // Component differences carry the reference component's name; route differences, the table's.
  const name = d.refName ?? (d.kind === 'extra' ? undefined : d.area);
  const named = (x: DesignDecision) => !!name && !!x.components?.includes(name);
  const first = (pred: (x: DesignDecision) => boolean) => decisions.findIndex(pred);
  if (d.field) {
    const f = d.field;
    const hasField = (x: DesignDecision) => !!x.fields?.some((k) => f === k || f.startsWith(`${k}.`));
    for (const pred of [
      (x: DesignDecision) => hasField(x) && (!x.components || named(x)), // this setting on this component
      (x: DesignDecision) => !x.fields?.length && named(x), // anything about this component
      hasField, // this setting, wherever it is
    ]) {
      const i = first(pred);
      if (i >= 0) return i;
    }
    return first(named);
  }
  const i = first((x) => named(x) && !x.fields?.length);
  return i >= 0 ? i : first(named);
}

export function buildDebrief(m: Mission, player: Board, results: EventResult[] | undefined): Debrief {
  const ref = m.reference;
  const decisions = m.decisions ?? [];
  const diffs = compareToReference(player, ref);
  const byDecision: RefDifference[][] = decisions.map(() => []);
  const other: RefDifference[] = [];
  for (const d of diffs) {
    // An extra service the reference never uses is explained in `extras` instead.
    if (d.kind === 'extra' && !Object.values(ref.components).some((c) => c.type === d.types[0])) continue;
    const i = owner(d, decisions);
    (i >= 0 ? byDecision[i] : other).push(d);
  }
  const eventName = (id: string) => m.events.find((e) => e.id === id)?.name ?? id;
  const failingIds = (d: DesignDecision) => d.events.filter((id) => results?.some((r) => r.eventId === id && r.status !== 'pass'));
  const reviews: DecisionReview[] = decisions.map((decision, i) => {
    const ran = decision.events.some((id) => results?.some((r) => r.eventId === id));
    const failing = failingIds(decision);
    // A shared event (an AZ outage) fails for one reason; don't blame the decisions the player got right.
    const explainedElsewhere = failing.every((id) => decisions.some((o, j) => j !== i && byDecision[j].length > 0 && failingIds(o).includes(id)));
    const status: DecisionStatus = !ran ? 'untested' : !failing.length ? 'covered' : byDecision[i].length || !explainedElsewhere ? 'missed' : 'same';
    return { decision, status, failing: failing.map(eventName), diffs: byDecision[i] };
  });

  const refTypes = new Set(Object.values(ref.components).map((c) => c.type));
  const extraByType = new Map<ServiceType, string[]>();
  for (const c of Object.values(player.components)) if (!refTypes.has(c.type)) extraByType.set(c.type, [...(extraByType.get(c.type) ?? []), c.name]);
  const extras = [...extraByType].map(([type, names]) => ({ type, names, note: m.whyNot?.[type] }));

  const pairs = referencePairs(player, ref);
  const playerMarks: Debrief['playerMarks'] = {};
  const refMarks: Debrief['refMarks'] = {};
  const paired = new Set([...pairs.values()].filter(Boolean) as string[]);
  for (const c of Object.values(player.components)) if (!paired.has(c.id)) playerMarks[c.id] = 'extra';
  for (const [rid, pid] of pairs) if (!pid) refMarks[rid] = 'missing';
  for (const d of diffs)
    if (d.kind === 'changed' && d.refId) {
      refMarks[d.refId] ??= 'changed';
      const pid = pairs.get(d.refId);
      if (pid) playerMarks[pid] ??= 'changed';
    }
  const allPass = !!results?.length && results.every((r) => r.status === 'pass');
  return { decisions: reviews, other, extras, playerMarks, refMarks, allPass };
}
