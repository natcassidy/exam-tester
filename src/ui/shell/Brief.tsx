import { requirementStatus } from '../../engine/sim/runner';
import { refactorBaselines, useGame } from '../../store/game';
import { refactorCost } from '../../engine/scoring';
import { StuckLadder } from '../assist/StuckLadder';
import { hasHardMode } from '../../engine/palette';

/** Easy / hard switch: hard mixes services the design doesn't need into the palette. */
export function DifficultyToggle() {
  const difficulty = useGame((s) => s.settings.difficulty ?? 'easy');
  const setDifficulty = useGame((s) => s.setDifficulty);
  return (
    <span className="seg" role="radiogroup" aria-label="Difficulty">
      {(['easy', 'hard'] as const).map((d) => (
        <button key={d} role="radio" aria-checked={difficulty === d} className={difficulty === d ? 'on' : ''} onClick={() => setDifficulty(d)}>
          {d === 'easy' ? 'Easy' : 'Hard'}
        </button>
      ))}
    </span>
  );
}

export function Brief() {
  const mission = useGame((s) => s.mission());
  const results = useGame((s) => s.results[mission.id]);
  const resetBoard = useGame((s) => s.resetBoard);
  const status = results ? requirementStatus(mission, results) : null;
  const rs = useGame((s) => s.refactorScores[mission.id]);
  const startCost = mission.refactor ? refactorCost(mission, refactorBaselines(mission).start) : 0;
  const difficulty = useGame((s) => s.settings.difficulty ?? 'easy');
  const hard = difficulty === 'hard' && hasHardMode(mission);
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
        {hasHardMode(mission) && (
          <div className="section">
            <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Difficulty <DifficultyToggle />
            </h4>
            <p className="hint">
              {hard
                ? `Hard: the palette mixes in ${mission.distractors!.length} services this design doesn't need, and the exam signal phrases stay hidden until your first run. Picking the right tools is part of the job.`
                : 'Easy: the palette offers only the services this mission can use. Switch to hard to choose from extra, plausible services too.'}
            </p>
          </div>
        )}
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
        {(!!mission.hints?.length || (!mission.incident && !mission.diff)) && (
          <div className="section">
            <h4>Stuck?</h4>
            <StuckLadder compact />
          </div>
        )}
        <div className="section">
          <h4>Exam signal phrases</h4>
          {hard && !results ? (
            <p className="hint">Hidden in hard mode until your first run: they name the services.</p>
          ) : (
            <ul className="hint">
              {mission.keywords.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          )}
        </div>
        <button className="btn small ghost danger" onClick={() => (!mission.incident || confirm('Restart this incident? Your board, actions and diagnosis are cleared (your best score is kept).')) && resetBoard()}>
          {mission.incident ? 'Restart incident' : mission.refactor ? 'Restore the production board' : 'Reset board'}
        </button>
      </div>
    </>
  );
}
