import { useMemo, useState } from 'react';
import type { Board as BoardT, EventResult, SgRule, SgSource } from '../../engine/model';
import { runMission } from '../../engine/sim/runner';
import { displayOptions, letter } from '../../engine/mastery/exam';
import { subnetsOf } from '../../engine/board';
import { findSubnet } from '../../engine/net/routing';
import { iamOf, bucketPolicyDoc } from '../../engine/iam/access';
import { targetLabel } from '../../engine/net/routing';
import { manualTitle } from '../../content/manual';
import { describeSelection, Selection, useGame } from '../../store/game';
import { Board } from '../board/Board';
import { BoardViewContext } from '../board/context';
import { nextMission } from '../shell/MissionPicker';

type Side = 'left' | 'right';

const short = (v: unknown): string => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function srcLabel(b: BoardT, s: SgSource): string {
  if ('cidr' in s) return s.cidr;
  if ('sg' in s) return b.securityGroups[s.sg]?.name ?? s.sg;
  return s.prefixList;
}

const sgRule = (b: BoardT, r: SgRule) => `${r.protocol} ${r.fromPort === r.toPort ? r.fromPort : `${r.fromPort}-${r.toPort}`} ${srcLabel(b, r.source)}`;

/** Readable settings of one object, as label/value rows, so the two boards can be compared line by line. */
function describeObject(b: BoardT, sel: Selection): [string, string][] {
  const rows: [string, string][] = [];
  if (sel.kind === 'component') {
    const c = b.components[sel.id];
    if (!c) return [['exists', 'no']];
    rows.push(['exists', 'yes']);
    rows.push(['placement', c.placement.kind === 'subnet' ? subnetsOf(c).join(', ') : c.placement.kind]);
    for (const [k, v] of Object.entries(c.config)) if (k !== 'type' && k !== 'customPolicy' && k !== 'policyDoc') rows.push([k, short(v)]);
    for (const sgId of c.securityGroupIds ?? []) {
      const sg = b.securityGroups[sgId];
      if (!sg) continue;
      rows.push([`SG ${sg.name} inbound`, sg.inbound.map((r) => sgRule(b, r)).join(' · ') || 'none']);
      rows.push([`SG ${sg.name} outbound`, sg.outbound.map((r) => sgRule(b, r)).join(' · ') || 'none']);
    }
    if (c.roleId) {
      const r = iamOf(b).roles[c.roleId];
      rows.push(['role', r?.name ?? c.roleId]);
      for (const p of r?.policies ?? []) rows.push([`policy ${p.name}`, JSON.stringify(p.doc.Statement)]);
    }
    if (c.config.type === 's3') rows.push(['bucket policy', short(bucketPolicyDoc(b, c)?.Statement ?? null)]);
    if (c.config.type === 'sqs' || c.config.type === 'vpce') rows.push([c.config.type === 'vpce' ? 'endpoint policy' : 'queue policy', short(c.config.policyDoc?.Statement ?? null)]);
    return rows;
  }
  if (sel.kind === 'subnet') {
    const s = findSubnet(b, sel.id)?.subnet;
    if (!s) return [['Exists', 'no']];
    const rt = b.routeTables[s.routeTableId];
    const nacl = b.nacls[s.naclId];
    rows.push(['CIDR', s.cidr]);
    rows.push(['route table', rt?.name ?? s.routeTableId]);
    for (const r of rt?.routes ?? []) rows.push([`route ${r.dest}`, r.target === 'local' ? 'local' : (b.components[targetLabel(r.target).split(':')[1]]?.name ?? `${targetLabel(r.target)} (blackhole)`)]);
    rows.push(['network ACL', nacl?.name ?? s.naclId]);
    for (const dir of ['inbound', 'outbound'] as const) for (const r of nacl?.[dir] ?? []) rows.push([`NACL ${dir} #${r.ruleNumber}`, `${r.action} ${r.protocol} ${r.portRange[0]}-${r.portRange[1]} ${r.cidr}`]);
    return rows;
  }
  return rows;
}

function Inspector({ sel, left, right, labels }: { sel: Selection; left: BoardT; right: BoardT; labels: [string, string] }) {
  const l = describeObject(left, sel);
  const r = describeObject(right, sel);
  const keys = [...new Set([...l.map((x) => x[0]), ...r.map((x) => x[0])])];
  const get = (rows: [string, string][], k: string) => rows.find((x) => x[0] === k)?.[1] ?? '—';
  return (
    <div className="section">
      <h4>Inspecting {describeSelection(left, sel)}</h4>
      <table className="compare">
        <thead>
          <tr>
            <th />
            <th>{labels[0]}</th>
            <th>{labels[1]}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const a = get(l, k);
            const b = get(r, k);
            return (
              <tr key={k} className={a !== b ? 'differs' : ''}>
                <td className="hint">{k}</td>
                <td className="mono">{a}</td>
                <td className="mono">{b}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">Highlighted rows differ between the two boards.</p>
    </div>
  );
}

function SideBoard({ side, board, label, result, selection, onSelect }: { side: Side; board: BoardT; label: string; result?: EventResult; selection: Selection | null; onSelect: (s: Selection | null) => void }) {
  const view = useMemo(() => ({ board, readOnly: true, idPrefix: `${side}:`, selection, select: onSelect }), [board, side, selection, onSelect]);
  return (
    <section className="diff-side" aria-label={label}>
      <div className="diff-side-head">
        <h3>{label}</h3>
        {result && <span className={`tag ${result.status}`}>{result.status === 'pass' ? 'SURVIVED' : 'FAILED'}</span>}
      </div>
      <div className="diff-board">
        <BoardViewContext.Provider value={view}>
          <Board />
        </BoardViewContext.Provider>
      </div>
    </section>
  );
}

export function useDiffState() {
  const mission = useGame((s) => s.mission());
  const [results, setResults] = useState<Record<string, { left: EventResult; right: EventResult }>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const d = mission.diff!;
  const run = () => setResults((r) => ({ ...r, [mission.id]: { left: runMission(d.left, mission)[0], right: runMission(d.right, mission)[0] } }));
  return { mission, d, results: results[mission.id], run, selection, setSelection };
}

export function DiffBoards({ state }: { state: ReturnType<typeof useDiffState> }) {
  const { d, results, selection, setSelection } = state;
  return (
    <div className="diff-boards">
      <SideBoard side="left" board={d.left} label={d.leftLabel} result={results?.left} selection={selection} onSelect={setSelection} />
      <SideBoard side="right" board={d.right} label={d.rightLabel} result={results?.right} selection={selection} onSelect={setSelection} />
    </div>
  );
}

export function DiffPanel({ state }: { state: ReturnType<typeof useDiffState> }) {
  const { mission, d, results, run, selection, setSelection } = state;
  const answer = useGame((s) => s.diffAnswers[mission.id]);
  const answerDiff = useGame((s) => s.answerDiff);
  const openQuestions = useGame((s) => s.openQuestions);
  const setMission = useGame((s) => s.setMission);
  const next = nextMission(mission.id);
  const openManual = useGame((s) => s.openManual);
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = answer?.chosen ?? null;
  const ev = mission.events[0];
  return (
    <>
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          <h2>{mission.title}</h2>
          <div className="sub">
            Spot the Difference · {mission.client}
          </div>
        </div>
      </div>
      <div className="panel-body brief">
        <p>“{mission.brief}”</p>
        <div className="section">
          <h4>The event</h4>
          <p>
            <b>{ev.name}.</b> <span className="hint">{ev.desc}</span>
          </p>
          <button className="btn small" onClick={run}>
            ▶ Run it on both boards
          </button>
          {results && (
            <div className="detail-lines" style={{ marginTop: 8 }}>
              {(['left', 'right'] as const).map((side) => (
                <div key={side}>
                  <span className="k">{side === 'left' ? d.leftLabel : d.rightLabel}</span>
                  <span className={results[side].status === 'pass' ? 'allow' : 'deny'}>{results[side].summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {selection && selection.kind !== 'iam' ? (
          <>
            <Inspector sel={selection} left={d.left} right={d.right} labels={[d.leftLabel, d.rightLabel]} />
            <button className="btn ghost small" onClick={() => setSelection(null)}>
              Close inspector
            </button>
          </>
        ) : (
          <p className="hint">Click any component or subnet on either board to compare its settings side by side.</p>
        )}
        <div className="section" style={{ marginTop: 14 }}>
          <h4>{d.question}</h4>
          {displayOptions({ id: mission.id, options: d.options }).map((o, i) => {
            const isChosen = (chosen ?? picked) === o.id;
            const cls = chosen ? (o.id === d.correct ? 'right' : isChosen ? 'wrong' : '') : isChosen ? 'chosen' : '';
            return (
              <button key={o.id} className={`q-opt ${cls}`} disabled={!!chosen} aria-pressed={isChosen} onClick={() => setPicked(o.id)}>
                <span className="mono">{letter(i)}.</span>
                <span>{o.text}</span>
                {chosen && <span className="why">{o.id === d.correct ? '✓ ' : '✗ '}{o.why}</span>}
              </button>
            );
          })}
          {!chosen ? (
            <button className="btn primary" disabled={!picked} onClick={() => picked && answerDiff(picked)}>
              Lock in answer
            </button>
          ) : (
            <>
              <p className={answer.correct ? 'allow' : 'deny'}>{answer.correct ? 'Correct on the first try: 3 stars.' : 'Not this time: 1 star. Read why below, then try the practice questions.'}</p>
              <div className="lesson">{d.explanation}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {next && (
                  <button className="btn primary" onClick={() => setMission(next.id)}>
                    Next round →
                  </button>
                )}
                <button className="btn" onClick={() => openQuestions(true)}>
                  Practice questions
                </button>
                {mission.concepts.slice(0, 3).map((c) => (
                  <button key={c} className="btn ghost small" onClick={() => openManual(c)}>
                    ☰ {manualTitle(c)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** The whole Spot the Difference screen: two read-only boards plus the question panel. */
export function DiffMain({ isMobile }: { isMobile: boolean }) {
  const state = useDiffState();
  if (isMobile)
    return (
      <main className="col center diff-main">
        <DiffBoards state={state} />
        <div className="diff-panel-inline">
          <DiffPanel state={state} />
        </div>
      </main>
    );
  return (
    <>
      <main className="col center diff-main">
        <DiffBoards state={state} />
      </main>
      <aside className="col right">
        <DiffPanel state={state} />
      </aside>
    </>
  );
}
