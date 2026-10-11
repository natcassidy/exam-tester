import type { AuditFinding, AuditRule } from '../../engine/audit/rules';
import { runAudit } from '../../engine/audit/rules';
import type { Board, Mission } from '../../engine/model';
import { useGame } from '../../store/game';

export interface LiveIssue {
  rule: AuditRule;
  finding: AuditFinding;
}

export interface LiveAudit {
  issues: LiveIssue[];
  byComponent: Record<string, LiveIssue[]>;
  /** Checks that had something to look at (an empty board has none). */
  applicable: number;
}

// Every node on the board asks, so compute once per board and mission.
const cache = new WeakMap<Board, Map<string, LiveAudit | null>>();

function compute(board: Board, mission: Mission): LiveAudit | null {
  const rules = [...new Set(mission.events.filter((e) => e.kind === 'audit').flatMap((e) => (e.params.rules as string[]) ?? []))];
  if (!rules.length) return null;
  const all = runAudit(board, rules);
  const issues = all.filter((f) => f.finding.status === 'fail');
  const byComponent: Record<string, LiveIssue[]> = {};
  for (const i of issues) for (const id of i.finding.highlight) (byComponent[id] ??= []).push(i);
  return { issues, byComponent, applicable: all.filter((f) => f.finding.status !== 'na').length };
}

/**
 * The mission's audit checks, re-run on every edit. Off in incidents (where it would point at the
 * root cause for free), in Spot the Difference, and when the player turns it off in Settings.
 */
export function useLiveAudit(): LiveAudit | null {
  const mission = useGame((s) => s.mission());
  const board = useGame((s) => s.board());
  const enabled = useGame((s) => s.settings.liveChecks !== false);
  if (!enabled || mission.incident || mission.diff) return null;
  let perMission = cache.get(board);
  if (!perMission) cache.set(board, (perMission = new Map()));
  if (!perMission.has(mission.id)) perMission.set(mission.id, compute(board, mission));
  return perMission.get(mission.id)!;
}
