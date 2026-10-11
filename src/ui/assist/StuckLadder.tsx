import { useGame } from '../../store/game';
import { Icon } from '../shell/Icon';

/**
 * Help in steps, from least to most given away: the mission's hints one at a time, then the
 * reference design (build and refactor missions only). Each step is recorded, and the concepts it
 * covers come back sooner in spaced repetition.
 */
export function StuckLadder({ eventId, compact = false }: { eventId?: string; compact?: boolean }) {
  const mission = useGame((s) => s.mission());
  const assist = useGame((s) => s.assists[s.currentMissionId]);
  const revealHint = useGame((s) => s.revealHint);
  const openReference = useGame((s) => s.openReference);
  const hints = mission.hints ?? [];
  const shown = Math.min(assist?.hints ?? 0, hints.length);
  const canReference = !mission.incident && !mission.diff;
  const allHints = shown >= hints.length;
  return (
    <div className={`stuck ${compact ? 'compact' : ''}`}>
      {!compact && (
        <p className="hint">
          Help comes in steps: each one gives away a little more. Asking is fine; the concepts involved come back sooner in your daily session so they stick.
        </p>
      )}
      {shown > 0 && (
        <ol className="hints">
          {hints.slice(0, shown).map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ol>
      )}
      <div className="stuck-actions">
        {!allHints && (
          <button className="btn small" onClick={() => revealHint(eventId)}>
            <Icon name="help" /> {shown ? 'Next hint' : 'Show a hint'} ({shown + 1} of {hints.length}){mission.incident ? ' · costs 1 action' : ''}
          </button>
        )}
        {canReference && (allHints || !hints.length) && (
          <button className="btn small" onClick={() => openReference({ eventId })}>
            <Icon name="map" /> Compare with the reference design
          </button>
        )}
        {canReference && !allHints && hints.length > 0 && <span className="hint">The reference comparison unlocks after the last hint.</span>}
        {!canReference && allHints && hints.length > 0 && <span className="hint">That's every hint. Trace the failing path and read the logs: the evidence names the setting.</span>}
      </div>
    </div>
  );
}
