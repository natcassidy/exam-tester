import { useMemo } from 'react';
import { runMission } from '../../engine/sim/runner';
import { refactorCost } from '../../engine/scoring';
import { refactorBaselines, useGame } from '../../store/game';

const usd = (n: number) => `$${n < 100 ? n.toFixed(2).replace(/\.00$/, '') : Math.round(n).toLocaleString()}`;

/** Live monthly estimate: against the budget on build missions, against production on refactors. */
function CostMeter() {
  const mission = useGame((s) => s.mission());
  const board = useGame((s) => s.board());
  const costEvents = useMemo(() => {
    const ids = mission.refactor?.costEvents;
    return mission.events.filter((e) => (ids ? ids.includes(e.id) : e.kind === 'bill'));
  }, [mission]);
  const cost = useMemo(
    () => (costEvents.length ? refactorCost(mission, runMission(board, { ...mission, events: costEvents })) : null),
    [board, mission, costEvents],
  );
  if (cost === null || mission.incident) return null;

  if (mission.refactor) {
    const start = refactorCost(mission, refactorBaselines(mission).start);
    const saved = start - cost;
    return (
      <div className="cost-meter" title="Live estimate of the costs this refactor is scored on (approximate us-east-1 prices). Run the simulation to score it.">
        <span className="hint">Production</span>
        <span className="mono">{usd(start)}</span>
        <span className="hint">→ now</span>
        <b className={`mono ${saved > 0.5 ? 'pass' : saved < -0.5 ? 'fail' : ''}`}>{usd(cost)}/mo</b>
        {Math.abs(saved) > 0.5 && <span className={`tag ${saved > 0 ? 'pass' : 'fail'}`}>{saved > 0 ? `−${usd(saved)}` : `+${usd(-saved)}`}</span>}
      </div>
    );
  }

  const budget = (costEvents[0].params?.budget as number | undefined) ?? mission.budget;
  if (!budget) return null;
  const pct = Math.min(100, (cost / budget) * 100);
  const over = cost > budget;
  return (
    <div className={`cost-meter ${over ? 'over' : ''}`} title="Live estimate of the monthly bill (approximate us-east-1 prices). The Monthly bill event checks it against the budget.">
      <span className="hint">Est. bill</span>
      <span className="meter" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </span>
      <b className="mono">{usd(cost)}</b>
      <span className="hint">of {usd(budget)}/mo</span>
    </div>
  );
}

/** The packet tracer and IAM: tools that inspect the board. */
export function BoardTools() {
  const traceOpen = useGame((s) => s.traceOpen);
  const openTrace = useGame((s) => s.openTrace);
  const select = useGame((s) => s.select);
  const iamOpen = useGame((s) => !s.traceOpen && !!s.selection && ['iam', 'role', 'key', 'scp'].includes(s.selection.kind));
  return (
    <>
      <button className={`btn small ${traceOpen ? 'on' : ''}`} onClick={() => openTrace(!traceOpen)} title="Send a request through your design and see every hop, or simulate an API call through IAM" aria-pressed={traceOpen}>
        <span aria-hidden>⟿</span> Trace
      </button>
      <button
        className={`btn small ${iamOpen ? 'on' : ''}`}
        onClick={() => {
          openTrace(false);
          select(iamOpen ? null : { kind: 'iam' });
        }}
        title="Roles, users, KMS keys and SCPs"
        aria-pressed={iamOpen}
      >
        <span aria-hidden>⚿</span> IAM
      </button>
    </>
  );
}

/** The bar above the board: the brief (mobile), the live cost, and (unless the incident bar has them) the tools. */
export function BoardToolbar({ onBrief, tools = true }: { onBrief?: () => void; tools?: boolean }) {
  return (
    <div className="board-toolbar" role="toolbar" aria-label="Board tools">
      {onBrief && (
        <button className="btn small" onClick={onBrief}>
          Brief
        </button>
      )}
      <CostMeter />
      <span style={{ flex: 1 }} />
      {tools && <BoardTools />}
    </div>
  );
}
