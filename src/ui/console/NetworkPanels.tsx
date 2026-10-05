import { useState } from 'react';
import type { Component, NaclRule, Protocol, RouteTarget, SgRule } from '../../engine/model';
import * as ops from '../../engine/board';
import { MULTI_SUBNET, subnetsOf, vpcOfComponent } from '../../engine/board';
import { evaluateNacl, sortedRules } from '../../engine/net/nacl';
import { describeSgRule, sourceLabel } from '../../engine/net/sg';
import { allSubnets, effectiveRoutes, findSubnet, PREFIX_LISTS, subnetPublicStatus, targetLabel, validTargets } from '../../engine/net/routing';
import { useGame } from '../../store/game';

const PROTOS: Protocol[] = ['tcp', 'udp', 'icmp', 'all'];

function parseRuleRef(ref?: string): { dir?: 'inbound' | 'outbound'; num?: string } {
  if (!ref) return {};
  const m = ref.match(/^(inbound|outbound) rule[s]? ?#?(\S+)?/);
  if (!m) return {};
  return { dir: m[1] as 'inbound' | 'outbound', num: m[2] };
}

// ---------- Security groups ----------

export function SgEditor({ sgId, ruleRef }: { sgId: string; ruleRef?: string }) {
  const board = useGame((s) => s.board());
  const apply = useGame((s) => s.apply);
  const sg = board.securityGroups[sgId];
  const hit = parseRuleRef(ruleRef);
  const [dir, setDir] = useState<'inbound' | 'outbound'>(hit.dir ?? 'inbound');
  const [action, setAction] = useState<'allow' | 'deny'>('allow');
  const [proto, setProto] = useState<Protocol>('tcp');
  const [from, setFrom] = useState(443);
  const [to, setTo] = useState(443);
  const [srcKind, setSrcKind] = useState<'cidr' | 'sg' | 'prefixList'>('cidr');
  const [src, setSrc] = useState('0.0.0.0/0');
  if (!sg) return <p className="hint">Security group not found.</p>;
  const owners = Object.values(board.components).filter((c) => c.securityGroupIds?.includes(sg.id));
  const sgs = Object.values(board.securityGroups).filter((x) => x.vpcId === sg.vpcId);
  const add = () => {
    const source: SgRule['source'] = srcKind === 'cidr' ? { cidr: src } : srcKind === 'sg' ? { sg: src } : { prefixList: src };
    apply((b) => ops.addSgRule(b, sg.id, dir, { protocol: proto, fromPort: from, toPort: proto === 'all' ? 65535 : to, source, action }), 'Rule added.');
  };
  const table = (d: 'inbound' | 'outbound') => (
    <table className="rules">
      <thead>
        <tr>
          <th>#</th>
          <th>Protocol / ports</th>
          <th>{d === 'inbound' ? 'Source' : 'Destination'}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {sg[d].map((r, i) => (
          <tr key={i} className={hit.dir === d && hit.num === `${i + 1}` ? 'hit' : ''}>
            <td className="mono">{i + 1}</td>
            <td className="mono">{r.protocol === 'all' ? 'All traffic' : `${r.protocol.toUpperCase()} ${r.fromPort === r.toPort ? r.fromPort : `${r.fromPort}-${r.toPort}`}`}</td>
            <td className="mono" title={r.description}>
              {sourceLabel(board, r.source)}
            </td>
            <td>
              <button className="btn ghost small" onClick={() => apply((b) => ops.removeSgRule(b, sg.id, d, i))} aria-label="Remove rule">
                ✕
              </button>
            </td>
          </tr>
        ))}
        {sg[d].length === 0 && (
          <tr className={`implicit ${hit.dir === d ? 'hit' : ''}`}>
            <td colSpan={4}>No rules: all {d} traffic is denied.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
  return (
    <div className="section">
      <h4>
        Security group {sg.name} <span className="mono">({sg.id})</span>
      </h4>
      <p className="hint">Stateful, allow-only. Attached to: {owners.map((o) => o.name).join(', ') || 'nothing'}.</p>
      <div className="hint" style={{ marginTop: 6 }}>Inbound</div>
      {table('inbound')}
      <div className="hint" style={{ marginTop: 6 }}>Outbound</div>
      {table('outbound')}
      <div className="rule-form">
        <select value={dir} onChange={(e) => setDir(e.target.value as 'inbound' | 'outbound')} aria-label="Direction">
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value as 'allow' | 'deny')} aria-label="Action">
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
        <select value={proto} onChange={(e) => setProto(e.target.value as Protocol)} aria-label="Protocol">
          {PROTOS.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
        {proto !== 'all' && proto !== 'icmp' && (
          <>
            <input type="number" value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="From port" />
            <span className="hint">to</span>
            <input type="number" value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="To port" />
          </>
        )}
        <select
          value={srcKind}
          onChange={(e) => {
            const k = e.target.value as 'cidr' | 'sg' | 'prefixList';
            setSrcKind(k);
            setSrc(k === 'cidr' ? '0.0.0.0/0' : k === 'sg' ? (sgs[0]?.id ?? '') : 'pl-s3');
          }}
          aria-label="Source type"
        >
          <option value="cidr">CIDR</option>
          <option value="sg">Security group</option>
          <option value="prefixList">Prefix list</option>
        </select>
        {srcKind === 'cidr' && <input type="text" value={src} onChange={(e) => setSrc(e.target.value)} aria-label="CIDR" />}
        {srcKind === 'sg' && (
          <select value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Security group">
            {sgs.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        {srcKind === 'prefixList' && (
          <select value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Prefix list">
            {Object.keys(PREFIX_LISTS).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
        <button className="btn small primary" onClick={add}>
          Add rule
        </button>
      </div>
    </div>
  );
}

// ---------- NACLs ----------

export function NaclEditor({ naclId, ruleRef }: { naclId: string; ruleRef?: string }) {
  const board = useGame((s) => s.board());
  const apply = useGame((s) => s.apply);
  const nacl = board.nacls[naclId];
  const hit = parseRuleRef(ruleRef);
  const [dir, setDir] = useState<'inbound' | 'outbound'>(hit.dir ?? 'inbound');
  const [num, setNum] = useState(110);
  const [proto, setProto] = useState<Protocol>('tcp');
  const [from, setFrom] = useState(1024);
  const [to, setTo] = useState(65535);
  const [cidr, setCidr] = useState('0.0.0.0/0');
  const [action, setAction] = useState<'allow' | 'deny'>('allow');
  const [testPort, setTestPort] = useState(443);
  const [testIp, setTestIp] = useState('203.0.113.10');
  if (!nacl) return <p className="hint">Network ACL not found.</p>;
  const used = allSubnets(board).filter((s) => s.naclId === nacl.id);
  const table = (d: 'inbound' | 'outbound') => {
    const test = (() => {
      try {
        return evaluateNacl(nacl, d, 'tcp', testPort, testIp);
      } catch {
        return null;
      }
    })();
    return (
      <table className="rules">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Proto</th>
            <th>Ports</th>
            <th>{d === 'inbound' ? 'Source' : 'Destination'}</th>
            <th>Action</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sortedRules(nacl[d]).map((r: NaclRule) => (
            <tr key={r.ruleNumber} className={(hit.dir === d && hit.num === `${r.ruleNumber}`) || (test && test.ruleNumber === r.ruleNumber && !hit.dir) ? 'hit' : ''}>
              <td className="mono">{r.ruleNumber}</td>
              <td className="mono">{r.protocol.toUpperCase()}</td>
              <td className="mono">{r.protocol === 'all' ? 'All' : `${r.portRange[0]}-${r.portRange[1]}`}</td>
              <td className="mono">{r.cidr}</td>
              <td className={r.action}>{r.action.toUpperCase()}</td>
              <td>
                <button className="btn ghost small" onClick={() => apply((b) => ops.removeNaclRule(b, nacl.id, d, r.ruleNumber))} aria-label="Remove rule">
                  ✕
                </button>
              </td>
            </tr>
          ))}
          <tr className={`implicit ${(hit.dir === d && hit.num === '*') || (test && test.ruleNumber === '*' && !hit.dir) ? 'hit' : ''}`}>
            <td className="mono">*</td>
            <td>All</td>
            <td>All</td>
            <td className="mono">0.0.0.0/0</td>
            <td className="deny">DENY</td>
            <td />
          </tr>
        </tbody>
      </table>
    );
  };
  return (
    <div className="section">
      <h4>
        Network ACL {nacl.name} <span className="mono">({nacl.id})</span>
      </h4>
      <p className="hint">Stateless, evaluated lowest rule number first; first match wins. Used by: {used.map((s) => s.name).join(', ') || 'no subnet'}.</p>
      <div className="hint" style={{ marginTop: 6 }}>Inbound (evaluation order)</div>
      {table('inbound')}
      <div className="hint" style={{ marginTop: 6 }}>Outbound (evaluation order)</div>
      {table('outbound')}
      <div className="rule-form">
        <span className="hint">Preview a TCP packet:</span>
        <input type="number" value={testPort} onChange={(e) => setTestPort(Number(e.target.value))} aria-label="Test port" />
        <input type="text" value={testIp} onChange={(e) => setTestIp(e.target.value)} aria-label="Test peer IP" />
        <span className="hint">
          In: <b>{(() => { try { const d = evaluateNacl(nacl, 'inbound', 'tcp', testPort, testIp); return `${d.action} (#${d.ruleNumber})`; } catch { return '—'; } })()}</b> · Out:{' '}
          <b>{(() => { try { const d = evaluateNacl(nacl, 'outbound', 'tcp', testPort, testIp); return `${d.action} (#${d.ruleNumber})`; } catch { return '—'; } })()}</b>
        </span>
      </div>
      <div className="rule-form">
        <select value={dir} onChange={(e) => setDir(e.target.value as 'inbound' | 'outbound')} aria-label="Direction">
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
        <input type="number" value={num} onChange={(e) => setNum(Number(e.target.value))} aria-label="Rule number" />
        <select value={proto} onChange={(e) => setProto(e.target.value as Protocol)} aria-label="Protocol">
          {PROTOS.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
        {proto !== 'all' && proto !== 'icmp' && (
          <>
            <input type="number" value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="From port" />
            <input type="number" value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="To port" />
          </>
        )}
        <input type="text" value={cidr} onChange={(e) => setCidr(e.target.value)} aria-label="CIDR" />
        <select value={action} onChange={(e) => setAction(e.target.value as 'allow' | 'deny')} aria-label="Action">
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
        <button className="btn small primary" onClick={() => apply((b) => ops.addNaclRule(b, nacl.id, dir, { ruleNumber: num, protocol: proto, portRange: proto === 'all' ? [0, 65535] : [from, to], cidr, action }), 'Rule added.')}>
          Add rule
        </button>
      </div>
      <p className="hint">Return traffic uses ephemeral ports 1024-65535 and needs its own rule.</p>
    </div>
  );
}

// ---------- Route tables ----------

export function RouteTableEditor({ rtId, ruleRef }: { rtId: string; ruleRef?: string }) {
  const board = useGame((s) => s.board());
  const apply = useGame((s) => s.apply);
  const rt = board.routeTables[rtId];
  const targets = rt ? validTargets(board, rt).filter((t) => t.target !== 'local') : [];
  const [dest, setDest] = useState('0.0.0.0/0');
  const [target, setTarget] = useState(0);
  if (!rt) return <p className="hint">Route table not found.</p>;
  const routes = effectiveRoutes(board, rt.id);
  const hitDest = ruleRef?.startsWith('route ') ? ruleRef.slice(6) : null;
  const used = allSubnets(board).filter((s) => s.routeTableId === rt.id);
  const tLabel = (t: RouteTarget) => {
    if (t === 'local') return 'local';
    const id = Object.values(t)[0];
    const c = board.components[id];
    return c ? c.name : `${targetLabel(t)} (blackhole)`;
  };
  return (
    <div className="section">
      <h4>
        Route table {rt.name} <span className="mono">({rt.id})</span>
      </h4>
      <p className="hint">Longest prefix wins. Associated with: {used.map((s) => s.name).join(', ') || 'no subnet'}.</p>
      <table className="rules">
        <thead>
          <tr>
            <th>Destination</th>
            <th>Target</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={r.dest + targetLabel(r.target)} className={hitDest === r.dest || ruleRef === 'routes' ? 'hit' : ''}>
              <td className="mono">{r.dest}{PREFIX_LISTS[r.dest] ? ` (${PREFIX_LISTS[r.dest].service.toUpperCase()} prefix list)` : ''}</td>
              <td className="mono">{tLabel(r.target)}</td>
              <td>
                {r.target !== 'local' && !r.propagated && (
                  <button className="btn ghost small" onClick={() => apply((b) => ops.removeRoute(b, rt.id, r.dest))} aria-label="Remove route">
                    ✕
                  </button>
                )}
                {r.propagated && <span className="hint">endpoint</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rule-form">
        <input type="text" value={dest} onChange={(e) => setDest(e.target.value)} aria-label="Destination CIDR" />
        <span className="hint">→</span>
        <select value={target} onChange={(e) => setTarget(Number(e.target.value))} aria-label="Target">
          {targets.map((t, i) => (
            <option key={i} value={i}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          className="btn small primary"
          disabled={!targets.length}
          onClick={() => {
            const t = targets[target];
            if (!t) return;
            const existing = rt.routes.find((r) => r.dest === dest);
            apply((b) => (existing ? ops.setRouteTarget(b, rt.id, dest, t.target) : ops.addRoute(b, rt.id, { dest, target: t.target })), existing ? 'Route updated.' : 'Route added.');
          }}
        >
          {rt.routes.some((r) => r.dest === dest) ? 'Replace route' : 'Add route'}
        </button>
      </div>
      {!targets.length && <p className="hint">Place an internet gateway or NAT gateway to get route targets.</p>}
    </div>
  );
}

// ---------- Subnet ----------

export function SubnetPanel({ subnetId }: { subnetId: string }) {
  const board = useGame((s) => s.board());
  const apply = useGame((s) => s.apply);
  const f = findSubnet(board, subnetId);
  if (!f) return null;
  const s = f.subnet;
  const status = subnetPublicStatus(board, s);
  const rts = Object.values(board.routeTables).filter((r) => r.vpcId === f.vpc.id);
  const nacls = Object.values(board.nacls).filter((n) => n.vpcId === f.vpc.id);
  return (
    <>
      <div className="section">
        <h4>Associations</h4>
        <p>
          <span className={`tag ${status.isPublic ? 'public' : 'private'}`}>{status.isPublic ? 'Public' : 'Private'}</span> <span className="hint">{status.reason}</span>
        </p>
        <label className="field">
          <span>Route table</span>
          <select value={s.routeTableId} onChange={(e) => apply((b) => ops.associateSubnet(b, s.id, 'routeTableId', e.target.value))}>
            {rts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Network ACL</span>
          <select value={s.naclId} onChange={(e) => apply((b) => ops.associateSubnet(b, s.id, 'naclId', e.target.value))}>
            {nacls.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn small"
          style={{ marginTop: 6 }}
          onClick={() => {
            const name = `nacl-${s.name}`;
            apply((b) => {
              const r = ops.createNacl(b, f.vpc.id, name);
              return r.ok ? ops.associateSubnet(r.board, s.id, 'naclId', r.id!) : r;
            }, `Created ${name}. Custom NACLs deny everything until you add rules.`);
          }}
        >
          + New custom NACL for this subnet
        </button>
      </div>
      <RouteTableEditor rtId={s.routeTableId} />
      <NaclEditor naclId={s.naclId} />
    </>
  );
}

// ---------- Component networking ----------

export function ComponentNetworking({ c }: { c: Component }) {
  const board = useGame((s) => s.board());
  const apply = useGame((s) => s.apply);
  const vpc = vpcOfComponent(board, c);
  if (c.placement.kind !== 'subnet') {
    return <p className="hint">{c.name} is a {c.placement.kind === 'edge' ? 'global' : c.placement.kind === 'region' ? 'regional' : 'VPC-level'} resource. It has no subnets or security groups.</p>;
  }
  const subs = vpc ? vpc.azs.flatMap((a) => a.subnets) : [];
  const chosen = subnetsOf(c);
  const sgs = Object.values(board.securityGroups).filter((s) => s.vpcId === vpc?.id);
  return (
    <>
      {MULTI_SUBNET.includes(c.type) && (
        <div className="section">
          <h4>{c.type === 'rds' ? 'DB subnet group' : c.type === 'alb' ? 'Enabled subnets' : 'Subnets'}</h4>
          {subs.map((s) => (
            <label key={s.id} className="field">
              <span>
                {s.name} <span className="mono hint">{s.azId}</span>
                {c.type === 'rds' && chosen[0] === s.id && <span className="tag muted" style={{ marginLeft: 6 }}>primary</span>}
                {c.type === 'rds' && c.config.type === 'rds' && c.config.multiAz && chosen[0] !== s.id && chosen.includes(s.id) && findSubnet(board, s.id)?.subnet.azId !== findSubnet(board, chosen[0])?.subnet.azId && (
                  <span className="tag muted" style={{ marginLeft: 6 }}>standby</span>
                )}
              </span>
              <input
                type="checkbox"
                checked={chosen.includes(s.id)}
                onChange={(e) => apply((b) => ops.setSubnets(b, c.id, e.target.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id)))}
              />
            </label>
          ))}
          {c.type === 'asg' && <p className="hint">Instances are spread evenly across these subnets' AZs.</p>}
        </div>
      )}
      {c.securityGroupIds && (
        <div className="section">
          <h4>Security groups attached</h4>
          {sgs.map((sg) => (
            <label key={sg.id} className="field">
              <span>
                {sg.name} <span className="hint">{sg.inbound.map((r) => describeSgRule(board, r)).join('; ') || 'no inbound rules'}</span>
              </span>
              <input
                type="checkbox"
                checked={c.securityGroupIds!.includes(sg.id)}
                onChange={(e) => apply((b) => ops.attachSecurityGroups(b, c.id, e.target.checked ? [...c.securityGroupIds!, sg.id] : c.securityGroupIds!.filter((x) => x !== sg.id)))}
              />
            </label>
          ))}
          <button
            className="btn small"
            style={{ marginTop: 6 }}
            onClick={() =>
              apply((b) => {
                const r = ops.createSecurityGroup(b, vpc!.id, `${c.name}-sg-${Object.keys(b.securityGroups).length + 1}`);
                return r.ok ? ops.attachSecurityGroups(r.board, c.id, [...(c.securityGroupIds ?? []), r.id!]) : r;
              }, 'Security group created and attached.')
            }
          >
            + New security group
          </button>
        </div>
      )}
      {(c.securityGroupIds ?? []).map((id) => (
        <SgEditor key={id} sgId={id} />
      ))}
      <div className="section">
        <h4>Subnet networking</h4>
        {chosen.map((sid) => {
          const s = findSubnet(board, sid)?.subnet;
          if (!s) return null;
          const st = subnetPublicStatus(board, s);
          return (
            <div key={sid} className="hint">
              {s.name}: <span className={`tag ${st.isPublic ? 'public' : 'private'}`}>{st.isPublic ? 'Public' : 'Private'}</span> {board.routeTables[s.routeTableId]?.name} · {board.nacls[s.naclId]?.name}
            </div>
          );
        })}
        <p className="hint">Click a subnet on the board to edit its route table and network ACL.</p>
      </div>
    </>
  );
}
