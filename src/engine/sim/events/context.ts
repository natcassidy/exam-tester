import type { Board, EventResult, EventSpec, UsageProfile } from '../../model';

export interface SimContext {
  budget: number;
  usage: UsageProfile;
}

export type EventHandler = (board: Board, ev: EventSpec, ctx: SimContext) => EventResult;

export function result(ev: EventSpec, r: Omit<EventResult, 'eventId' | 'manual'> & { manual?: string[] }): EventResult {
  return { eventId: ev.id, manual: r.manual ?? ev.concepts, ...r };
}

export const fmtSec = (s: number) => {
  if (!Number.isFinite(s)) return 'never (manual recovery)';
  if (s < 120) return `${Math.round(s)}s`;
  if (s < 7200) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
};

export const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
