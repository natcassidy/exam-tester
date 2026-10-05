import { useState } from 'react';
import type { EventResult, EventSpec } from '../../engine/model';
import { DOMAIN_LABELS } from '../../engine/model';
import { scoreResults } from '../../engine/scoring';
import { manualTitle } from '../../content/manual';
import { useGame, Selection } from '../../store/game';
import { Stars } from '../shell/Abbr';
import { Timeline } from './Timeline';
import { resolveEndpoint } from '../../engine/select';
import type { IncidentScore } from '../../engine/incident/score';
import { listSuspects } from '../../engine/incident/suspects';
import type { Mission } from '../../engine/model';
import type { RefactorScore } from '../../engine/scoring';
import { DEFENDS } from '../../content/defend';
import { MISSION_BY_ID } from '../../content/missions';
import { nextMission } from '../shell/MissionPicker';

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function RefactorReport({ rs }: { rs: RefactorScore }) {
  const saved = rs.startCost - rs.cost;
  return (
    <article className="result report" style={{ gridColumn: '1 / -1' }}>
      <div className="result-head">
        <h4>Refactor report</h4>
        <Stars n={rs.stars} />
        <span className="mono">{rs.points}/100</span>
      </div>
      <div className="report-row">
        <span className={`tag ${rs.allPass ? 'pass' : 'fail'}`}>
          {rs.passed}/{rs.total}
        </span>
        <b>Requirements</b>
        <span className="hint">{rs.allPass ? 'Every requirement still holds after the change.' : 'A cheaper design that breaks a requirement earns no savings points.'}</span>
      </div>
      <div className="report-row">
        <span className={`tag ${rs.savingsRatio >= 0.95 ? 'pass' : rs.savingsRatio >= 0.5 ? 'warn' : 'fail'}`}>{Math.round(rs.savingsRatio * 100)}%</span>
        <b>Savings</b>
        <span className="hint">
          {usd(rs.startCost)}/mo → {usd(rs.cost)}/mo ({saved >= 0 ? `${usd(saved)} saved` : `${usd(-saved)} more`}). The reference design costs {usd(rs.targetCost)}/mo.
        </span>
      </div>
      <div className="cost-bar" aria-hidden>
        <span className="target" style={{ width: `${Math.min(100, (rs.targetCost / Math.max(rs.startCost, rs.cost, 1)) * 100)}%` }} />
        <span className="now" style={{ width: `${Math.min(100, (rs.cost / Math.max(rs.startCost, rs.cost, 1)) * 100)}%` }} />
      </div>
      <div className="hint">
        <span style={{ color: 'var(--accent)' }}>■</span> your design · <span style={{ color: 'var(--pass)' }}>■</span> reference design · full width = the more expensive of production and yours
      </div>
    </article>
  );
}

function IncidentReport({ mission, report }: { mission: Mission; report: IncidentScore }) {
  const inc = mission.incident!;
  const suspects = listSuspects(mission.startingBoard!);
  const name = (id: string | null) => {
    const s = suspects.find((x) => x.id === id);
    return s ? `${s.group} · ${s.label}` : (id ?? 'none');
  };
  const row = (label: string, pts: number, max: number, text: string) => (
    <div className="report-row">
      <span className={`tag ${pts === max ? 'pass' : pts > 0 ? 'warn' : 'fail'}`}>
        {pts}/{max}
      </span>
      <b>{label}</b>
      <span className="hint">{text}</span>
    </div>
  );
  return (
    <article className="result report" style={{ gridColumn: '1 / -1' }}>
      <div className="result-head">
        <h4>Incident report</h4>
        <Stars n={report.stars} />
        <span className="mono">{report.total}/100</span>
      </div>
      {row('Root cause', report.rootCause.points, 50, report.rootCause.correct ? `Correct: ${name(inc.rootCause)}.` : `You named ${name(report.rootCause.picked)}. It was ${name(inc.rootCause)}.`)}
      {row('Fix', report.fix.points, 30, report.fix.allPass ? 'Every check passes again.' : report.fix.symptomFixed ? 'The alert cleared, but another requirement now fails.' : 'The alert is still firing.')}
      {row('Investigation', report.actions.points, 10, `${report.actions.used} actions (par ${report.actions.par}, budget ${report.actions.budget}).${report.fix.symptomFixed ? '' : ' Counts once the alert is fixed.'}`)}
      {row('Blast radius', report.collateral.points, 10, !report.fix.symptomFixed ? 'Counts once the alert is fixed.' : report.collateral.changes.length ? `Changes nobody needed: ${report.collateral.changes.map((c) => `${c.desc}${c.danger ? ' (dangerous)' : ''}`).join('; ')}.` : 'You changed only what the fix needed.')}
      <div className="lesson">{inc.rootCauseExplain}</div>
    </article>
  );
}

function fixSelection(id: string | undefined, board: ReturnType<ReturnType<typeof useGame.getState>['board']>): Selection | null {
  if (!id) return null;
  if (board.components[id]) return { kind: 'component', id };
  if (board.securityGroups[id]) return { kind: 'sg', id };
  if (board.nacls[id]) return { kind: 'nacl', id };
  if (board.routeTables[id]) return { kind: 'routeTable', id };
  return { kind: 'subnet', id };
}

function metricChip(r: EventResult): string | null {
  const m = r.metrics;
  if (!m) return null;
  if (m.rtoSec !== undefined) return `RTO ${Number.isFinite(m.rtoSec) ? Math.round(m.rtoSec) + 's' : '∞'} · RPO ${Number.isFinite(m.rpoSec) ? Math.round(m.rpoSec) + 's' : '∞'}`;
  if (m.errorRate !== undefined) return `${(m.errorRate * 100).toFixed(2)}% errors`;
  if (m.monthly !== undefined) return `$${m.monthly.toLocaleString()}/mo`;
  if (m.latencyMs !== undefined) return `~${m.latencyMs} ms`;
  if (m.maxAgeSec !== undefined) return Number.isFinite(m.maxAgeSec) ? `oldest ${Math.round(m.maxAgeSec / 60)} min` : 'never drains';
  return null;
}

function ResultCard({ ev, r, missionId, surprise }: { ev: EventSpec; r: EventResult; missionId: string; surprise?: boolean }) {
  const [open, setOpen] = useState(r.status !== 'pass');
  const board = useGame((s) => s.board());
  const select = useGame((s) => s.select);
  const showTrace = useGame((s) => s.showTrace);
  const openManual = useGame((s) => s.openManual);
  const openTrace = useGame((s) => s.openTrace);
  const openDefend = useGame((s) => s.openDefend);
  const defended = useGame((s) => !!s.defends[`${missionId}/${ev.id}`]);
  // A refactor's prompts are about the new design, so they open once every requirement passes.
  const refactorPending = useGame((s) => !!MISSION_BY_ID[missionId]?.refactor && !s.refactorScores[missionId]?.allPass);
  const canDefend = !!DEFENDS[`${missionId}/${ev.id}`] && !refactorPending;
  const fix = fixSelection(r.fixTarget, board);
  const chip = metricChip(r);
  const mission = MISSION_BY_ID[missionId];
  const reqs = (ev.requirementIds ?? []).map((id) => mission?.requirements.find((q) => q.id === id)?.text).filter(Boolean) as string[];
  return (
    <article className={`result ${r.status}${surprise ? ' surprise' : ''}`}>
      <div className="result-head">
        {surprise && <span className="tag accent">SURPRISE</span>}
        <span className={`tag ${r.status}`}>{r.status.toUpperCase()}</span>
        <h4>{ev.name}</h4>
        {chip && <span className="tag muted mono">{chip}</span>}
      </div>
      <div className="hint">{ev.desc}</div>
      {reqs.length > 0 && (
        <div className="checks">
          <span className="hint">Checks</span> {reqs.join(' · ')}
        </div>
      )}
      <div className="summary">{r.summary}</div>
      {r.timeline && <Timeline series={r.timeline} />}
      {open && r.detail && (
        <>
          {r.detail.lines.length > 0 && (
            <div className="detail-lines">
              {r.detail.lines.map((l, i) => (
                <div key={i}>
                  <span className="k">{l.label}</span>
                  <span className={l.status ?? ''}>{l.value}</span>
                </div>
              ))}
            </div>
          )}
          {r.detail.lineItems && (
            <table className="line-items">
              <tbody>
                {r.detail.lineItems.map((li, i) => (
                  <tr key={i}>
                    <td className="hint">{li.service}</td>
                    <td>{li.item}</td>
                    <td>${li.monthly.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {r.status !== 'pass' && r.lesson && <div className="lesson">{r.lesson}</div>}
      <div className="actions">
        {r.detail && (
          <button className="btn small ghost" onClick={() => setOpen(!open)}>
            {open ? 'Hide detail' : 'Detail'}
          </button>
        )}
        {r.trace && (
          <button
            className="btn small"
            onClick={() => {
              const from = resolveEndpoint(board, ev.params.from) ?? 'internet';
              const to = resolveEndpoint(board, ev.params.to) ?? 'internet';
              showTrace(r.trace!, { from, to, protocol: 'tcp', port: ev.params.port, clientCity: ev.params.clientCity }, ev.name);
              openTrace(true);
            }}
          >
            ⟿ Show trace
          </button>
        )}
        {r.status !== 'pass' && fix && (
          <button className="btn small primary" onClick={() => select(fix)}>
            Fix it
          </button>
        )}
        {canDefend && r.status === 'pass' && (
          <button className="btn small" onClick={() => openDefend({ missionId, eventId: ev.id })} title="Defend your design: explain in your own words why it passes, then grade yourself against a rubric">
            {defended ? '✓ Explain again' : 'Explain why it passes'}
          </button>
        )}
        {r.manual.slice(0, 3).map((id) => (
          <button key={id} className="btn small ghost" onClick={() => openManual(id)}>
            ☰ {manualTitle(id)}
          </button>
        ))}
      </div>
    </article>
  );
}

export function SimDrawer() {
  const mission = useGame((s) => s.mission());
  const results = useGame((s) => s.results[mission.id]);
  const open = useGame((s) => s.simOpen);
  const setOpen = useGame((s) => s.openSim);
  const runSim = useGame((s) => s.runSim);
  const openQuestions = useGame((s) => s.openQuestions);
  const report = useGame((s) => s.reports[mission.id]);
  const diagnosis = useGame((s) => s.incident().diagnosis);
  const refactor = useGame((s) => s.refactorScores[mission.id]);
  const surprise = useGame((s) => s.surprise[mission.id]);
  const setMission = useGame((s) => s.setMission);
  const score = results && !refactor ? scoreResults(mission.events, results) : null;
  const isIncident = !!mission.incident;
  const stars = report?.stars ?? refactor?.stars ?? score?.stars ?? 0;
  const next = stars === 3 ? nextMission(mission.id) : null;
  const pending = score?.incomplete ? results!.filter((r) => r.incomplete).length : 0;
  return (
    <section className={`drawer ${open ? '' : 'closed'}`} aria-label="Simulation">
      <div className="drawer-head">
        <button className="drawer-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          <h3>{isIncident ? 'Verification' : 'Simulation'}</h3>
          <span className="caret" aria-hidden>
            {open ? '▾' : '▴'}
          </span>
        </button>
        {report && (
          <span className="score">
            <Stars n={report.stars} />
            <span className="hint">{report.total}/100</span>
          </span>
        )}
        {refactor && (
          <span className="score">
            <Stars n={refactor.stars} />
            <span className="hint">
              {refactor.passed}/{refactor.total} passed · {usd(refactor.cost)}/mo · {refactor.points} pts
            </span>
          </span>
        )}
        {!isIncident && score && (
          <span className="score">
            <Stars n={score.stars} />
            {score.incomplete ? (
              <span className="hint">
                <b className="incomplete">Design incomplete</b> · {pending} {pending === 1 ? 'check has' : 'checks have'} nothing to test yet. Place what {pending === 1 ? 'it needs' : 'they need'} to earn stars.
              </span>
            ) : (
              <span className="hint">
                {score.passed}/{score.total} passed · {score.points} pts
              </span>
            )}
          </span>
        )}
        {!results && <span className="hint drawer-sub">{isIncident ? 'Diagnose, fix, then verify.' : `${mission.events.length} events will test your design.`}</span>}
        <span style={{ flex: 1 }} />
        {results && (
          <button className="btn" onClick={() => openQuestions(true)} title="Exam-style questions on the concepts this mission tested">
            Practice questions
          </button>
        )}
        <button className={`btn ${next ? '' : 'primary'}`} onClick={runSim} title={isIncident && !diagnosis ? 'Diagnose the root cause first' : undefined}>
          {isIncident ? '✓ Verify fix' : results ? '▶ Run again' : '▶ Run simulation'}
        </button>
        {next && (
          <button className="btn primary" onClick={() => setMission(next.id)} title={next.title}>
            Next mission →
          </button>
        )}
      </div>
      {open && (
        <div className="drawer-body">
          {!results && !isIncident && <p className="hint">Run the simulation to throw this mission's events at your design: {mission.events.map((e) => e.name).join(' · ')}.</p>}
          {!results && isIncident && (
            <p className="hint">
              Investigate, name the root cause (Diagnose), fix it with the smallest change, then Verify fix. Verification replays: {mission.events.map((e) => e.name).join(' · ')}.
            </p>
          )}
          {report && <IncidentReport mission={mission} report={report} />}
          {refactor && <RefactorReport rs={refactor} />}
          {results &&
            mission.events.map((ev) => {
              const r = results.find((x) => x.eventId === ev.id);
              return r ? <ResultCard key={ev.id + r.status + r.summary} ev={ev} r={r} missionId={mission.id} /> : null;
            })}
          {results && surprise?.result && <ResultCard key={`surprise${surprise.result.status}${surprise.result.summary}`} ev={surprise.event} r={surprise.result} missionId={mission.id} surprise />}
          {score && !isIncident && (
            <div className="result" style={{ borderLeftColor: 'var(--accent)' }}>
              <div className="result-head">
                <h4>Score by domain</h4>
              </div>
              <div className="detail-lines">
                {Object.entries(score.domains).map(([d, v]) => (
                  <div key={d}>
                    <span className="k">{DOMAIN_LABELS[d as keyof typeof DOMAIN_LABELS]}</span>
                    <span>
                      {v!.earned}/{v!.total}
                    </span>
                  </div>
                ))}
              </div>
              {score.stars === 3 && <p className="summary">Every event passed. Check it transfers with the practice questions, or move on to the next mission.</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
