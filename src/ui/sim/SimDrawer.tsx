import { useState } from 'react';
import type { EventResult, EventSpec, FixPointer } from '../../engine/model';
import { DOMAIN_LABELS } from '../../engine/model';
import { scoreResults } from '../../engine/scoring';
import { manualTitle } from '../../content/manual';
import { useGame } from '../../store/game';
import { Stars } from '../shell/Abbr';
import { Timeline } from './Timeline';
import { resolveEndpoint } from '../../engine/select';
import type { IncidentScore } from '../../engine/incident/score';
import { listSuspects } from '../../engine/incident/suspects';
import type { Mission } from '../../engine/model';
import type { RefactorScore } from '../../engine/scoring';
import { DEFENDS } from '../../content/defend';
import { MISSION_BY_ID } from '../../content/missions';
import { Icon } from '../shell/Icon';
import { StuckLadder } from '../assist/StuckLadder';
import { revealOnBoard } from '../assist/reveal';

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

const fixOf = (r: EventResult): FixPointer | null => (r.fixHint ? { target: r.fixTarget, hint: r.fixHint, focus: r.fixFocus, ruleRef: r.fixRuleRef } : null);

function ResultCard({ ev, r, missionId, surprise }: { ev: EventSpec; r: EventResult; missionId: string; surprise?: boolean }) {
  const failed = r.status !== 'pass';
  // Real failures open at full width; "nothing to test yet" and passes stay one line until clicked.
  const [open, setOpen] = useState(failed && !r.incomplete);
  // With several failed checks, list them all with their own fixes; one is already covered by "How to fix".
  const [detail, setDetail] = useState(r.status === 'fail' && (r.detail?.lines.filter((l) => l.status === 'fail' && l.fix).length ?? 0) > 1);
  const [stuck, setStuck] = useState(false);
  const board = useGame((s) => s.board());
  const followFix = useGame((s) => s.followFix);
  const showTrace = useGame((s) => s.showTrace);
  const openManual = useGame((s) => s.openManual);
  const openTrace = useGame((s) => s.openTrace);
  const openDefend = useGame((s) => s.openDefend);
  const defended = useGame((s) => !!s.defends[`${missionId}/${ev.id}`]);
  // A refactor's prompts are about the new design, so they open once every requirement passes.
  const refactorPending = useGame((s) => !!MISSION_BY_ID[missionId]?.refactor && !s.refactorScores[missionId]?.allPass);
  const canDefend = !!DEFENDS[`${missionId}/${ev.id}`] && !refactorPending;
  const fix = failed ? fixOf(r) : null;
  const chip = metricChip(r);
  const onBoard = [...r.highlight, ...(r.fixTarget && board.securityGroups[r.fixTarget] ? [r.fixTarget] : [])];
  if (!open)
    return (
      <button id={`result-${ev.id}`} className={`result compact ${r.status}${surprise ? ' surprise' : ''}`} onClick={() => setOpen(true)} aria-expanded={false}>
        <span className={`tag ${r.status}`}>{r.status.toUpperCase()}</span>
        <b>{ev.name}</b>
        {chip && <span className="tag muted mono">{chip}</span>}
        <span className="hint one-line">{r.summary}</span>
      </button>
    );
  return (
    <article id={`result-${ev.id}`} className={`result ${r.status}${surprise ? ' surprise' : ''}${failed ? ' wide' : ''}`}>
      <div className="result-head">
        {surprise && <span className="tag accent">SURPRISE</span>}
        <span className={`tag ${r.status}`}>{r.status.toUpperCase()}</span>
        <h4>{ev.name}</h4>
        {chip && <span className="tag muted mono">{chip}</span>}
        {(!failed || r.incomplete) && (
          <button className="btn ghost small" onClick={() => setOpen(false)} aria-label="Collapse">
            ▴
          </button>
        )}
      </div>
      <div className="hint">{ev.desc}</div>
      <div className="summary">{r.summary}</div>
      {fix && (
        <div className="how-to-fix">
          <Icon name="target" />
          <div>
            <div className="hint">How to fix</div>
            <div>{fix.hint}</div>
          </div>
          <div className="fix-actions">
            {fix.target && (
              <button
                className="btn small primary"
                onClick={() => {
                  followFix(fix, ev.name);
                  revealOnBoard(board, [fix.target!]);
                }}
              >
                Fix it
              </button>
            )}
            {onBoard.length > 0 && (
              <button className="btn small" onClick={() => revealOnBoard(board, onBoard)}>
                Show on board
              </button>
            )}
          </div>
        </div>
      )}
      {r.timeline && <Timeline series={r.timeline} />}
      {detail && r.detail && (
        <>
          {r.detail.lines.length > 0 && (
            <div className="detail-lines">
              {r.detail.lines.map((l, i) => (
                <div key={i}>
                  <span className="k">{l.label}</span>
                  <span className={l.status ?? ''}>
                    {l.value}
                    {l.status === 'fail' && l.fix && (
                      <span className="line-fix">
                        {l.fix.hint}
                        {l.fix.target && (
                          <button
                            className="btn small"
                            onClick={() => {
                              followFix(l.fix!, `${ev.name}: ${l.label}`);
                              revealOnBoard(board, [l.fix!.target!]);
                            }}
                          >
                            Fix it
                          </button>
                        )}
                      </span>
                    )}
                  </span>
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
      {failed && r.lesson && (
        <div className="lesson">
          {ev.kind === 'audit' && !r.incomplete && <span className="hint">Why it matters · </span>}
          {r.lesson}
        </div>
      )}
      <div className="actions">
        {r.detail && (r.detail.lines.length > 0 || r.detail.lineItems) && (
          <button className="btn small ghost" onClick={() => setDetail(!detail)} aria-expanded={detail}>
            {detail ? 'Hide checks' : r.detail.lines.length > 1 ? `All ${r.detail.lines.length} checks` : 'Detail'}
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
            <Icon name="trace" /> Show trace
          </button>
        )}
        {failed && !surprise && (
          <button className={`btn small ${stuck ? 'on' : ''}`} onClick={() => setStuck(!stuck)} aria-expanded={stuck}>
            <Icon name="help" /> Stuck?
          </button>
        )}
        {canDefend && r.status === 'pass' && (
          <button className="btn small" onClick={() => openDefend({ missionId, eventId: ev.id })} title="Explain in your own words why your design passes">
            {defended ? '✓ Defend again' : 'Defend it'}
          </button>
        )}
        {r.manual.slice(0, 3).map((id) => (
          <button key={id} className="btn small ghost" onClick={() => openManual(id)}>
            ☰ {manualTitle(id)}
          </button>
        ))}
      </div>
      {stuck && <StuckLadder eventId={ev.id} />}
    </article>
  );
}

const ORDER = { fail: 0, warn: 1, pass: 2 } as const;

/** Drawer height the player dragged to, kept per browser. */
function useDrawerHeight(): [number | null, (h: number) => void] {
  const [h, setH] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem('br.drawerHeight'));
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  });
  const save = (v: number) => {
    setH(v);
    try {
      localStorage.setItem('br.drawerHeight', String(Math.round(v)));
    } catch {
      /* private mode: keep it for this session only */
    }
  };
  return [h, save];
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
  const stale = useGame((s) => !!s.results[mission.id] && s.resultsBoard[mission.id] !== s.board());
  const [height, setHeight] = useDrawerHeight();
  const score = results && !refactor ? scoreResults(mission.events, results) : null;
  const isIncident = !!mission.incident;
  const ordered = results
    ? mission.events
        .map((ev) => ({ ev, r: results.find((x) => x.eventId === ev.id) }))
        .filter((x): x is { ev: EventSpec; r: EventResult } => !!x.r)
        .sort((a, b) => ORDER[a.r.status] - ORDER[b.r.status])
    : [];
  const failing = ordered.filter((x) => x.r.status !== 'pass');
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (m: PointerEvent) => setHeight(Math.min(window.innerHeight * 0.85, Math.max(120, window.innerHeight - m.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <section className={`drawer ${open ? '' : 'closed'}`} aria-label="Simulation" style={open && height ? { maxHeight: 'none', height } : undefined}>
      {open && <div className="drawer-grip" onPointerDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize the results panel" title="Drag to resize" />}
      <div className="drawer-head">
        <h3>{isIncident ? 'Verification' : 'Simulation'}</h3>
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
            <span className="hint">
              {score.passed}/{score.total} passed · {score.points} pts
              {score.incomplete && <span title="Some events have nothing to test yet. Place the components they need to earn stars."> · design incomplete, no stars yet</span>}
            </span>
          </span>
        )}
        {failing.length > 0 && (
          <span className="failing-chips">
            <span className="hint">Failing:</span>
            {failing.map(({ ev, r }) => (
              <button
                key={ev.id}
                className={`tag ${r.status}`}
                onClick={() => {
                  setOpen(true);
                  setTimeout(() => document.getElementById(`result-${ev.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
                }}
              >
                {ev.name}
              </button>
            ))}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={runSim} title={isIncident && !diagnosis ? 'Diagnose the root cause first' : undefined}>
          {isIncident ? '✓ Verify fix' : <><Icon name="play" /> Run simulation</>}
        </button>
        {results && (
          <button className="btn" onClick={() => openQuestions(true)}>
            Transfer questions
          </button>
        )}
        <button className="btn ghost small" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Collapse results' : 'Expand results'}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className="drawer-body">
          {stale && (
            <div className="stale-banner">
              <span>The board has changed since this run, so these results may be out of date.</span>
              <button className="btn small primary" onClick={runSim}>
                {isIncident ? 'Verify again' : 'Run again'}
              </button>
            </div>
          )}
          {!results && !isIncident && <p className="hint">Run the simulation to throw this mission's events at your design: {mission.events.map((e) => e.name).join(' · ')}.</p>}
          {!results && isIncident && (
            <p className="hint">
              Investigate, name the root cause (Diagnose), fix it with the smallest change, then Verify fix. Verification replays: {mission.events.map((e) => e.name).join(' · ')}.
            </p>
          )}
          {report && <IncidentReport mission={mission} report={report} />}
          {refactor && <RefactorReport rs={refactor} />}
          {surprise?.result && surprise.result.status !== 'pass' && <ResultCard key={`surprise${surprise.result.status}${surprise.result.summary}`} ev={surprise.event} r={surprise.result} missionId={mission.id} surprise />}
          {ordered.map(({ ev, r }) => (
            <ResultCard key={ev.id + r.status + r.summary} ev={ev} r={r} missionId={mission.id} />
          ))}
          {surprise?.result && surprise.result.status === 'pass' && <ResultCard key={`surprise${surprise.result.status}${surprise.result.summary}`} ev={surprise.event} r={surprise.result} missionId={mission.id} surprise />}
          {score && !isIncident && (
            <div className="result wide" style={{ borderLeftColor: 'var(--accent)' }}>
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
