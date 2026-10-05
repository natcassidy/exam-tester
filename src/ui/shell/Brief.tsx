import { requirementStatus } from '../../engine/sim/runner';
import { useGame } from '../../store/game';

export function Brief() {
  const mission = useGame((s) => s.mission());
  const results = useGame((s) => s.results[mission.id]);
  const resetBoard = useGame((s) => s.resetBoard);
  const status = results ? requirementStatus(mission, results) : null;
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
        <div className="section">
          <h4>Mission setup</h4>
          <p className="hint">
            Defaults: <b>{mission.defaults === 'helpful' ? 'helpful' : 'bare'}</b>.{' '}
            {mission.defaults === 'helpful'
              ? 'New load balancers, app servers and databases come with chained security groups, and new NAT gateways become the default route for private subnets in their AZ.'
              : 'New components get an empty security group and nothing is pre-wired: you add every route yourself.'}{' '}
            Budget ≈ ${mission.budget.toLocaleString()}/month (approximate prices, us-east-1).
          </p>
        </div>
        <div className="section">
          <h4>Exam signal phrases</h4>
          <ul className="hint">
            {mission.keywords.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
        <button className="btn small ghost danger" onClick={() => confirm('Reset this mission\'s board?') && resetBoard()}>
          Reset board
        </button>
      </div>
    </>
  );
}
