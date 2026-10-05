import { requirementStatus } from '../../engine/sim/runner';
import { refactorBaselines, useGame } from '../../store/game';
import { refactorCost } from '../../engine/scoring';

export function Brief() {
  const mission = useGame((s) => s.mission());
  const results = useGame((s) => s.results[mission.id]);
  const resetBoard = useGame((s) => s.resetBoard);
  const status = results ? requirementStatus(mission, results) : null;
  const rs = useGame((s) => s.refactorScores[mission.id]);
  const startCost = mission.refactor ? refactorCost(mission, refactorBaselines(mission).start) : 0;
  return (
    <>
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          <h2>{mission.title}</h2>
          <div className="sub">
            {mission.client} · {mission.users}
          </div>
        </div>
      </div>
      <div className="panel-body brief">
        <p>“{mission.brief}”</p>
        {mission.refactor && (
          <div className="section change">
            <h4>What changed</h4>
            <p>{mission.refactor.change}</p>
            <p className="hint">
              This board is already in production at <b>${Math.round(startCost).toLocaleString()}/month</b>
              {rs ? (
                <>
                  ; your last run costs <b>${Math.round(rs.cost).toLocaleString()}/month</b>
                </>
              ) : null}
              . Cut the bill without breaking a requirement. Score: requirements 60, plus up to 40 for how much of the possible saving you find.
            </p>
          </div>
        )}
        {mission.incident && (
          <div className="section">
            <h4>How incidents work</h4>
            <ol className="hint" style={{ paddingLeft: 18, margin: 0 }}>
              <li>Investigate: read logs, open objects, run traces. Each new thing you look at costs one action (par {mission.incident.par}, budget {mission.incident.budget}).</li>
              <li>Diagnose: name the one setting that caused the alert.</li>
              <li>Fix it with the smallest change, then Verify fix.</li>
            </ol>
            <p className="hint">Score: root cause 50 · fix 30 · investigation 10 · no collateral changes 10.</p>
          </div>
        )}
        <div className="section">
          <h4>Requirements</h4>
          {mission.requirements.map((r) => {
            const st = status?.[r.id];
            return (
              <div key={r.id} className="req">
                <span className={`mark ${st ?? 'idle'}`}>{st === 'met' ? '✓' : st === 'missed' ? '✗' : '○'}</span>
                <span>{r.text}</span>
              </div>
            );
          })}
        </div>
        {!mission.incident && (
        <div className="section">
          <h4>Mission setup</h4>
          <p className="hint">
            Defaults: <b>{mission.defaults === 'helpful' ? 'helpful' : 'bare'}</b>.{' '}
            {mission.defaults === 'helpful'
              ? 'New load balancers, app servers and databases come with chained security groups, and new NAT gateways become the default route for private subnets in their AZ.'
              : 'New components get an empty security group and nothing is pre-wired: you add every route yourself.'}{' '}
            {mission.budget > 0 && <>Budget ≈ ${mission.budget.toLocaleString()}/month (approximate prices, us-east-1).</>}
          </p>
        </div>
        )}
        <div className="section">
          <h4>Exam signal phrases</h4>
          <ul className="hint">
            {mission.keywords.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
        <button className="btn small ghost danger" onClick={() => confirm(mission.incident ? 'Restart this incident? Your board, actions and diagnosis are cleared (your best score is kept).' : "Reset this mission's board?") && resetBoard()}>
          {mission.incident ? 'Restart incident' : mission.refactor ? 'Restore the production board' : 'Reset board'}
        </button>
      </div>
    </>
  );
}
