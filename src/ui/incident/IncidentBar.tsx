import { useMemo, useState } from 'react';
import type { LogSource } from '../../engine/model';
import { listSuspects } from '../../engine/incident/suspects';
import { useGame } from '../../store/game';

/** Alert banner, investigation budget and the incident's two tools: logs and diagnosis. */
export function IncidentBar() {
  const mission = useGame((s) => s.mission());
  const progress = useGame((s) => s.incident());
  const board = useGame((s) => s.board());
  const openLogs = useGame((s) => s.openLogs);
  const openDiagnose = useGame((s) => s.openDiagnose);
  const inc = mission.incident;
  if (!inc) return null;
  const used = progress.actions.length;
  const pct = Math.min(100, (used / inc.budget) * 100);
  const state = used <= inc.par ? 'good' : used <= inc.budget ? 'warn' : 'over';
  const suspect = progress.diagnosis ? listSuspects(mission.startingBoard ?? board).find((x) => x.id === progress.diagnosis) : null;
  return (
    <div className="incident-bar" role="region" aria-label="Incident">
      <div className="alert">
        <span className="siren" aria-hidden>
          ●
        </span>
        <div style={{ minWidth: 0 }}>
          <b>{inc.alert.title}</b>
          <div className="hint">{inc.alert.detail}</div>
        </div>
      </div>
      <div className="incident-tools">
        <div className={`budget ${state}`} title={`Par ${inc.par}, budget ${inc.budget}. Each object you open, log you read or ad-hoc trace you run costs one action, once.`}>
          <span className="hint">Investigation</span>
          <span className="meter" aria-hidden>
            <span style={{ width: `${pct}%` }} />
            <i style={{ left: `${(inc.par / inc.budget) * 100}%` }} />
          </span>
          <span className="mono">
            {used}/{inc.budget}
          </span>
          <span className="hint">par {inc.par}</span>
        </div>
        <button className="btn small" onClick={() => openLogs(true)}>
          ☷ Logs ({inc.logs.length})
        </button>
        <button className={`btn small ${progress.diagnosis ? '' : 'primary'}`} onClick={() => openDiagnose(true)}>
          {progress.diagnosis ? `Diagnosis: ${suspect ? `${suspect.group} · ${suspect.label}` : progress.diagnosis}` : '⌖ Diagnose'}
        </button>
      </div>
    </div>
  );
}

function LogView({ log }: { log: LogSource }) {
  return (
    <>
      {log.note && <p className="hint">{log.note}</p>}
      <pre className="log-lines" tabIndex={0} aria-label={log.title}>
        {log.lines.join('\n')}
      </pre>
    </>
  );
}

export function LogsModal() {
  const open = useGame((s) => s.logsOpen);
  const setOpen = useGame((s) => s.openLogs);
  const mission = useGame((s) => s.mission());
  const progress = useGame((s) => s.incident());
  const viewLog = useGame((s) => s.viewLog);
  const [current, setCurrent] = useState<string | null>(null);
  const logs = mission.incident?.logs ?? [];
  if (!open || !logs.length) return null;
  const seen = (id: string) => progress.actions.includes(`log:${id}`);
  const log = logs.find((l) => l.id === current && seen(l.id));
  const close = () => {
    setOpen(false);
    setCurrent(null);
  };
  return (
    <div className="modal-back" onClick={close} role="dialog" aria-modal aria-label="Logs">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Logs and metrics</h2>
          <span className="hint">Reading a source for the first time costs one investigation action.</span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="logs">
          <nav className="log-list" aria-label="Log sources">
            {logs.map((l) => (
              <button
                key={l.id}
                className={`log-src ${current === l.id ? 'on' : ''}`}
                onClick={() => {
                  viewLog(l.id);
                  setCurrent(l.id);
                }}
              >
                <span className="tag muted">{l.kind}</span>
                <span>{l.title}</span>
                {!seen(l.id) && <span className="hint">1 action</span>}
              </button>
            ))}
          </nav>
          <div className="panel-body">{log ? <LogView log={log} /> : <p className="hint">Pick a source. Start with the one most likely to tell you where the failure is, not just that it is failing.</p>}</div>
        </div>
      </div>
    </div>
  );
}

export function DiagnoseModal() {
  const open = useGame((s) => s.diagnoseOpen);
  const setOpen = useGame((s) => s.openDiagnose);
  const mission = useGame((s) => s.mission());
  const progress = useGame((s) => s.incident());
  const diagnose = useGame((s) => s.diagnose);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  // Suspects come from the starting board: what was there when the alert fired.
  const suspects = useMemo(() => (mission.startingBoard ? listSuspects(mission.startingBoard) : []), [mission]);
  if (!open || !mission.incident) return null;
  const locked = !!progress.verifiedAt;
  const choice = picked ?? progress.diagnosis;
  const filtered = suspects.filter((s) => `${s.group} ${s.label}`.toLowerCase().includes(q.toLowerCase()));
  const groups: Record<string, typeof suspects> = {};
  for (const s of filtered) (groups[s.group] ??= []).push(s);
  const close = () => {
    setOpen(false);
    setPicked(null);
    setQ('');
  };
  return (
    <div className="modal-back" onClick={close} role="dialog" aria-modal aria-label="Diagnose">
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Name the root cause</h2>
          <span style={{ flex: 1 }} />
          <button className="btn ghost small" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body">
          <p className="hint">
            Pick the one setting that caused the alert. The symptom is not the cause: an alarm, a 503 or a timeout tells you where to look, not what broke. Worth 50 of 100 points{locked ? '. Locked: you already verified a fix.' : '; it locks when you verify your fix.'}
          </p>
          <input type="search" placeholder="Filter suspects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter suspects" style={{ width: '100%', marginBottom: 8 }} />
          <div className="suspects">
            {Object.entries(groups).map(([g, items]) => (
              <fieldset key={g}>
                <legend>{g}</legend>
                {items.map((s) => (
                  <label key={s.id} className={`suspect ${choice === s.id ? 'on' : ''}`}>
                    <input type="radio" name="suspect" disabled={locked} checked={choice === s.id} onChange={() => setPicked(s.id)} />
                    <span>{s.label}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            {!filtered.length && <p className="hint">Nothing matches.</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn primary" disabled={locked || !picked || picked === progress.diagnosis} onClick={() => picked && (diagnose(picked), setPicked(null))}>
              Record diagnosis
            </button>
            <button className="btn ghost" onClick={close}>
              Keep investigating
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
