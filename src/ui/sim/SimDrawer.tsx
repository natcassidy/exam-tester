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

function ResultCard({ ev, r }: { ev: EventSpec; r: EventResult }) {
  const [open, setOpen] = useState(r.status !== 'pass');
  const board = useGame((s) => s.board());
  const select = useGame((s) => s.select);
  const showTrace = useGame((s) => s.showTrace);
  const openManual = useGame((s) => s.openManual);
  const openTrace = useGame((s) => s.openTrace);
  const fix = fixSelection(r.fixTarget, board);
  const chip = metricChip(r);
  return (
    <article className={`result ${r.status}`}>
      <div className="result-head">
        <span className={`tag ${r.status}`}>{r.status.toUpperCase()}</span>
        <h4>{ev.name}</h4>
        {chip && <span className="tag muted mono">{chip}</span>}
      </div>
      <div className="hint">{ev.desc}</div>
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
  const score = results ? scoreResults(mission.events, results) : null;
  const isIncident = !!mission.incident;
  return (
    <section className={`drawer ${open ? '' : 'closed'}`} aria-label="Simulation">
      <div className="drawer-head">
        <h3>{isIncident ? 'Verification' : 'Simulation'}</h3>
        {report && (
          <span className="score">
            <Stars n={report.stars} />
            <span className="hint">{report.total}/100</span>
          </span>
        )}
        {!isIncident && score && (
          <span className="score">
            <Stars n={score.stars} />
            <span className="hint">
              {score.passed}/{score.total} passed · {score.points} pts
            </span>
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={runSim} title={isIncident && !diagnosis ? 'Diagnose the root cause first' : undefined}>
          {isIncident ? '✓ Verify fix' : '▶ Run simulation'}
        </button>
        {results && (
          <button className="btn" onClick={() => openQuestions(true)}>
            Transfer questions
          </button>
        )}
        <button className="btn ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▴'}
        </button>
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
          {results &&
            mission.events.map((ev) => {
              const r = results.find((x) => x.eventId === ev.id);
              return r ? <ResultCard key={ev.id + r.status + r.summary} ev={ev} r={r} /> : null;
            })}
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
              {score.stars === 3 && <p className="summary">Every event passed. Now prove it transfers: try the questions.</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
