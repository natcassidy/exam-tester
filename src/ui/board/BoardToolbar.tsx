import { useGame } from '../../store/game';
import { Icon } from '../shell/Icon';
import { useLiveAudit } from './useLiveAudit';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

/** Undo/redo, reset, the Security view, live check status and the active trace, above the board. */
export function BoardToolbar() {
  const mission = useGame((s) => s.mission());
  const canUndo = useGame((s) => (s.history[s.currentMissionId]?.past.length ?? 0) > 0);
  const canRedo = useGame((s) => (s.history[s.currentMissionId]?.future.length ?? 0) > 0);
  const undo = useGame((s) => s.undo);
  const redo = useGame((s) => s.redo);
  const resetBoard = useGame((s) => s.resetBoard);
  const securityView = useGame((s) => s.securityView);
  const setSecurityView = useGame((s) => s.setSecurityView);
  const trace = useGame((s) => s.activeTrace);
  const stale = useGame((s) => !!s.activeTrace && s.activeTrace.board !== s.board());
  const rerunTrace = useGame((s) => s.rerunTrace);
  const clearTrace = useGame((s) => s.clearTrace);
  const select = useGame((s) => s.select);
  const followFix = useGame((s) => s.followFix);
  const charge = useGame((s) => s.charge);
  const live = useLiveAudit();
  const reset = () => {
    // Build boards can be brought back with Undo; an incident restart also clears the investigation.
    if (mission.incident && !confirm('Restart this incident? Your board, actions and diagnosis are cleared (your best score is kept).')) return;
    resetBoard();
  };
  const firstIssue = live?.issues[0];
  return (
    <div className="board-toolbar" onClick={(e) => e.stopPropagation()}>
      <div className="group" role="group" aria-label="History">
        <button className="btn small ghost" onClick={undo} disabled={!canUndo} title={`Undo (${MOD}Z)`} aria-label="Undo">
          <Icon name="undo" /> <span className="label">Undo</span>
        </button>
        <button className="btn small ghost" onClick={redo} disabled={!canRedo} title={`Redo (${MOD}${isMac ? '⇧Z' : 'Y'})`} aria-label="Redo">
          <Icon name="redo" /> <span className="label">Redo</span>
        </button>
        <button className="btn small ghost" onClick={reset} title={mission.incident ? 'Restart the incident from the alert' : mission.refactor ? 'Restore the production board (undoable)' : 'Clear the board (undoable)'}>
          <Icon name="reset" /> <span className="label">{mission.incident ? 'Restart' : 'Reset'}</span>
        </button>
      </div>
      <button
        className={`btn small ${securityView ? 'on' : 'ghost'}`}
        onClick={() => {
          // In an incident the view is evidence, like opening a security group: it costs an action.
          if (!securityView) charge('view:security', 'used the Security view');
          setSecurityView(!securityView);
        }}
        aria-pressed={securityView}
        title={`Draw which security group lets which tier in${mission.incident ? ' (costs 1 investigation action)' : ''}`}
      >
        <Icon name="shield" /> <span className="label">Security view</span>
      </button>
      {live && live.applicable > 0 && (
        <button
          className={`btn small ghost live ${live.issues.length ? 'bad' : 'ok'}`}
          title={live.issues.length ? live.issues.map((i) => `${i.rule.title}: ${i.finding.message}`).join('\n') : "The mission's security checks pass on this board."}
          onClick={() => {
            const f = firstIssue?.finding;
            if (f?.fix?.target) followFix(f.fix, `Live check: ${firstIssue!.rule.title}`);
            else if (f?.highlight[0]) select({ kind: 'component', id: f.highlight[0] });
          }}
          disabled={!live.issues.length}
        >
          <Icon name={live.issues.length ? 'warn' : 'shield'} /> {live.issues.length ? `${live.issues.length} security issue${live.issues.length > 1 ? 's' : ''}` : 'Security checks pass'}
        </button>
      )}
      <span style={{ flex: 1 }} />
      {trace && (
        <span className={`trace-chip ${stale ? 'stale' : ''}`}>
          <Icon name="trace" /> <span className="t">{trace.label}</span>
          {stale && <span className="hint">{trace.replayable ? 'board changed since' : 'from an earlier run'}</span>}
          {stale && trace.replayable && (
            <button className="btn small" onClick={rerunTrace}>
              Re-run
            </button>
          )}
          <button className="btn small ghost" onClick={clearTrace} aria-label="Clear trace" title="Clear the trace from the board">
            <Icon name="close" size={12} />
          </button>
        </span>
      )}
      {securityView && (
        <span className="sg-legend" aria-hidden>
          <i className="l-info" /> allowed from another tier's group <i className="l-open" /> open to 0.0.0.0/0 on a private tier
        </span>
      )}
    </div>
  );
}
