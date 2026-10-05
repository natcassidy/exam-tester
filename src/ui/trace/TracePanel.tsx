import { useState } from 'react';
import type { Board, Endpoint, Hop, Protocol } from '../../engine/model';
import { CITY_RTT } from '../../engine/net/trace';
import { SERVICES } from '../../content/services';
import { Selection, useGame } from '../../store/game';
import { allHops } from './TraceOverlay';
import { useTraceStep } from './traceStep';
import type { IamDecision } from '../../engine/iam/types';
import { iamOf } from '../../engine/iam/access';
import { ROLE_TYPES } from '../../engine/iam/ops';

const CHECK_LABEL: Record<string, string> = {
  'sg-out': 'SG outbound',
  'sg-in': 'SG inbound',
  'nacl-out': 'NACL outbound',
  'nacl-in': 'NACL inbound',
  route: 'Route lookup',
  igw: 'Internet gateway',
  nat: 'NAT gateway',
  vpce: 'Gateway endpoint',
  'lb-listener': 'Listener',
  'lb-target-health': 'Target health',
  'public-ip': 'Public IP',
  dns: 'DNS',
  edge: 'Edge',
  origin: 'Origin',
  az: 'Availability Zone',
  exists: 'Exists',
  'endpoint-policy': 'Endpoint policy',
  iam: 'Permissions (IAM)',
};

const STEP_LABEL: Record<string, string> = {
  'explicit-deny': 'Explicit deny?',
  scp: 'SCPs',
  'resource-policy': 'Resource policy',
  'endpoint-policy': 'Endpoint policy',
  boundary: 'Permissions boundary',
  identity: 'Identity policies',
  'implicit-deny': 'Implicit deny',
  'key-policy': 'Key policy',
  'trust-policy': 'Trust policy',
  decision: 'Decision',
};

function IamSteps({ d }: { d: IamDecision }) {
  return (
    <details className="iam-steps">
      <summary>Evaluation, step by step ({d.decision === 'allow' ? 'allowed' : d.reason === 'explicit-deny' ? 'explicit deny' : 'implicit deny'})</summary>
      <div className="hint mono" style={{ wordBreak: 'break-all' }}>
        {d.principalArn} → {d.action} → {d.resource}
      </div>
      <ol>
        {d.steps.map((st, i) => (
          <li key={i} className={st.result}>
            <b>{STEP_LABEL[st.kind] ?? st.kind}</b>
            {st.result !== 'info' && st.result !== 'skip' && <span className={st.result === 'allow' ? 'allow' : 'deny'}> {st.result}</span>}
            {st.result === 'skip' && <span className="hint"> n/a</span>}
            <div>{st.explain}</div>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function hopSelection(board: Board, h: Hop): Selection | null {
  if (h.at.kind === 'role') return { kind: 'role', id: h.at.id };
  if (h.at.kind === 'key') return { kind: 'key', id: h.at.id };
  if (h.matched?.objectId === 'scp') return { kind: 'scp' };
  const id = h.matched?.objectId ?? h.at.id;
  const ruleRef = h.matched?.ruleRef;
  if (board.securityGroups[id]) return { kind: 'sg', id, ruleRef };
  if (board.nacls[id]) return { kind: 'nacl', id, ruleRef };
  if (board.routeTables[id]) return { kind: 'routeTable', id, ruleRef };
  if (board.components[id]) return { kind: 'component', id };
  if (h.at.kind === 'subnet') return { kind: 'subnet', id: h.at.id };
  return null;
}

export function HopList({ hops, returnHops }: { hops: Hop[]; returnHops: Hop[] }) {
  const board = useGame((s) => s.board());
  const select = useGame((s) => s.select);
  const openTrace = useGame((s) => s.openTrace);
  const step = useTraceStep((s) => s.step);
  const all = [...hops, ...returnHops];
  const render = (h: Hop, i: number) => {
    const sel = hopSelection(board, h);
    return (
      <li key={i}>
        <button
          className={`hop ${h.result} ${i === step ? 'now' : ''}`}
          onClick={() => {
            if (!sel) return;
            select(sel, sel.kind === 'component' ? (h.check === 'iam' || h.check === 'endpoint-policy' ? 'permissions' : 'config') : 'networking');
            openTrace(false);
          }}
          disabled={!sel}
          title={sel ? 'Open this object in the console' : undefined}
        >
          <span className="ic">{h.result === 'allow' ? '✓' : h.result === 'deny' ? '✗' : '·'}</span>
          <span>
            <span className="chk">
              {CHECK_LABEL[h.check] ?? h.check}
              {h.matched ? ` · ${h.matched.ruleRef}` : ''}
            </span>
            <div className="ex">{h.explain}</div>
          </span>
        </button>
        {h.iam && <IamSteps d={h.iam} />}
      </li>
    );
  };
  return (
    <>
      <ol className="hops">{hops.map((h, i) => render(h, i))}</ol>
      {returnHops.length > 0 && (
        <>
          <h4 style={{ margin: '12px 0 6px', fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)' }}>Return path</h4>
          <ol className="hops">{returnHops.map((h, i) => render(h, hops.length + i))}</ol>
        </>
      )}
      {all.length === 0 && <p className="hint">No hops.</p>}
    </>
  );
}

function endpointOptions(board: Board, side: 'from' | 'to'): { value: Endpoint; label: string }[] {
  const out: { value: Endpoint; label: string }[] = [{ value: 'internet', label: 'Internet' }];
  for (const c of Object.values(board.components)) {
    if (c.type === 'igw' || c.type === 'vpce' || c.type === 'waf') continue;
    if (side === 'from' && c.placement.kind !== 'subnet' && c.type !== 'lambda') continue;
    if (side === 'from' && (c.type === 'alb' || c.type === 'nat')) continue;
    out.push({ value: c.id, label: `${c.name} (${SERVICES[c.type].name})` });
  }
  if (side === 'to') {
    out.push({ value: 'svc:s3', label: 'Amazon S3 (regional endpoint)' });
    out.push({ value: 'svc:dynamodb', label: 'Amazon DynamoDB (regional endpoint)' });
  }
  return out;
}

const ACTIONS_FOR: Record<string, string[]> = {
  s3: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
  sqs: ['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage'],
  dynamodb: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'],
  lambda: ['lambda:InvokeFunction'],
  key: ['kms:Decrypt', 'kms:GenerateDataKey', 'kms:Encrypt'],
  role: ['sts:AssumeRole'],
};

function resourceKind(board: Board, id: string): string {
  if (board.components[id]) return board.components[id].type;
  if (iamOf(board).keys[id]) return 'key';
  return 'role';
}

function ApiCallForm() {
  const board = useGame((s) => s.board());
  const active = useGame((s) => s.activeTrace);
  const runCallTrace = useGame((s) => s.runCallTrace);
  const iam = iamOf(board);
  const callers = [
    ...Object.values(board.components)
      .filter((c) => (ROLE_TYPES as readonly string[]).includes(c.type))
      .map((c) => ({ value: c.id, label: `${c.name}${c.roleId && iam.roles[c.roleId] ? ` (as ${iam.roles[c.roleId].name})` : ' (no role)'}` })),
    ...Object.values(iam.roles).map((r) => ({ value: r.id, label: `${r.kind === 'user' ? 'IAM user' : 'Role'} ${r.name}` })),
  ];
  const resources = [
    ...Object.values(board.components)
      .filter((c) => ['s3', 'sqs', 'dynamodb', 'lambda'].includes(c.type))
      .map((c) => ({ value: c.id, label: `${c.name} (${SERVICES[c.type].name})` })),
    ...Object.values(iam.keys).map((k) => ({ value: k.id, label: `KMS key ${k.alias}` })),
    ...Object.values(iam.roles)
      .filter((r) => r.kind === 'role')
      .map((r) => ({ value: r.id, label: `Role ${r.name} (assume it)` })),
  ];
  const [principal, setPrincipal] = useState(active?.call?.principal ?? callers[0]?.value ?? '');
  const [resource, setResource] = useState(active?.call?.resource ?? resources[0]?.value ?? '');
  const kind = resource ? resourceKind(board, resource) : 's3';
  const [action, setAction] = useState(active?.call?.action ?? ACTIONS_FOR[kind]?.[0] ?? '');
  const [objectKey, setObjectKey] = useState(active?.call?.objectKey ?? 'reports/2026/q3.csv');
  if (!callers.length || !resources.length)
    return <p className="hint">API calls need something that calls (an EC2, Auto Scaling or Lambda component, or an IAM role or user) and something to call (S3, SQS, DynamoDB, Lambda or a KMS key).</p>;
  const label = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
  return (
    <>
      <div className="trace-form">
        <label>
          Caller
          <select value={principal} onChange={(e) => setPrincipal(e.target.value)}>
            {callers.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Resource
          <select
            value={resource}
            onChange={(e) => {
              setResource(e.target.value);
              setAction(ACTIONS_FOR[resourceKind(board, e.target.value)]?.[0] ?? action);
            }}
          >
            {resources.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <input type="text" list="api-actions" value={action} onChange={(e) => setAction(e.target.value)} spellCheck={false} />
          <datalist id="api-actions">
            {(ACTIONS_FOR[kind] ?? []).map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        {kind === 's3' && (
          <label>
            Object key
            <input type="text" value={objectKey} onChange={(e) => setObjectKey(e.target.value)} spellCheck={false} />
          </label>
        )}
      </div>
      <button
        className="btn primary"
        disabled={!principal || !resource || !action.includes(':')}
        onClick={() => runCallTrace({ principal, action: action.trim(), resource, objectKey: kind === 's3' ? objectKey : undefined }, `${label(callers, principal)} → ${action.trim()} → ${label(resources, resource)}`)}
      >
        Simulate call
      </button>
      <p className="hint" style={{ marginTop: 6 }}>Runs the network path first (for callers in your VPC), then every policy AWS evaluates, in order.</p>
    </>
  );
}

export function TracePanel() {
  const board = useGame((s) => s.board());
  const active = useGame((s) => s.activeTrace);
  const runTrace = useGame((s) => s.runTrace);
  const openTrace = useGame((s) => s.openTrace);
  const clearTrace = useGame((s) => s.clearTrace);
  const runCallTrace = useGame((s) => s.runCallTrace);
  const fromOpts = endpointOptions(board, 'from');
  const toOpts = endpointOptions(board, 'to');
  const [from, setFrom] = useState<Endpoint>(active?.flow.from ?? 'internet');
  const [to, setTo] = useState<Endpoint>(active?.flow.to ?? (toOpts[1]?.value ?? 'internet'));
  const [port, setPort] = useState(active?.flow.port ?? 443);
  const [protocol, setProtocol] = useState<Protocol>(active?.flow.protocol ?? 'tcp');
  const [city, setCity] = useState(active?.flow.clientCity ?? 'virginia');
  const label = (v: Endpoint) => [...fromOpts, ...toOpts].find((o) => o.value === v)?.label ?? v;
  const [mode, setMode] = useState<'network' | 'api'>(active?.call ? 'api' : 'network');
  const runTraceAgain = () => (active?.call ? runCallTrace(active.call, active.label) : active && runTrace(active.flow, active.label));

  return (
    <>
      <div className="panel-head">
        <div style={{ flex: 1 }}>
          <h2>Packet tracer</h2>
          <div className="sub">Follow one flow hop by hop: SGs, NACLs, routes, gateways, and the way back. Or simulate an API call through every policy.</div>
        </div>
        <button className="btn ghost small" onClick={() => openTrace(false)} aria-label="Close tracer">
          ✕
        </button>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'network'} className={mode === 'network' ? 'on' : ''} onClick={() => setMode('network')}>
          Network flow
        </button>
        <button role="tab" aria-selected={mode === 'api'} className={mode === 'api' ? 'on' : ''} onClick={() => setMode('api')}>
          API call (IAM)
        </button>
      </div>
      <div className="panel-body">
        {mode === 'api' ? (
          <ApiCallForm />
        ) : (
          <>
            <div className="trace-form">
              <label>
                From
                <select value={from} onChange={(e) => setFrom(e.target.value)}>
                  {fromOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                To
                <select value={to} onChange={(e) => setTo(e.target.value)}>
                  {toOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Protocol
                <select value={protocol} onChange={(e) => setProtocol(e.target.value as Protocol)}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="icmp">ICMP</option>
                </select>
              </label>
              <label>
                Port
                <input type="number" min={0} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} />
              </label>
              {from === 'internet' && (
                <label style={{ gridColumn: '1 / 3' }}>
                  Client location
                  <select value={city} onChange={(e) => setCity(e.target.value)}>
                    {Object.entries(CITY_RTT).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={() => runTrace({ from, to, protocol, port, clientCity: from === 'internet' ? city : undefined }, `${label(from)} → ${label(to)} : ${port}`)}>
                Run trace
              </button>
            </div>
          </>
        )}
        {active && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={runTraceAgain}>
              Replay
            </button>
            <button className="btn ghost" onClick={clearTrace}>
              Clear
            </button>
          </div>
        )}
        {active && (
          <div style={{ marginTop: 12 }}>
            <div className="hint">{active.label}</div>
            <div className={`verdict ${active.trace.result}`}>
              {active.call ? (active.trace.result === 'delivered' ? 'Allowed' : 'Denied') : active.trace.result === 'delivered' ? 'Delivered' : 'Dropped'}
              {active.trace.latencyMs !== undefined && <span className="hint"> · ~{active.trace.latencyMs} ms</span>}
              {active.trace.via !== 'none' && active.trace.via !== 'local' && <span className="hint"> · via {active.trace.via.toUpperCase()}</span>}
            </div>
            {active.trace.paths && active.trace.paths.length > 1 && (
              <p className="hint">
                Per source subnet:{' '}
                {active.trace.paths.map((p) => (
                  <span key={p.subnetId} className={`tag ${p.result === 'delivered' ? 'pass' : 'fail'}`} style={{ marginRight: 4 }}>
                    {p.subnetId} {p.result === 'delivered' ? `✓ ${p.via}` : '✗'}
                  </span>
                ))}
                {' '}The hops below show {active.trace.result === 'dropped' ? 'the first failing path' : 'one path'}.
              </p>
            )}
            <HopList hops={active.trace.hops} returnHops={active.trace.returnHops} />
            {allHops(active.trace).length > 0 && <p className="hint" style={{ marginTop: 10 }}>Click a hop to open the rule or setting that decided it.</p>}
          </div>
        )}
      </div>
    </>
  );
}
