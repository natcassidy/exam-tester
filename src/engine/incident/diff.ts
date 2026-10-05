// Board diff: every change between two boards, keyed so missions can say which changes a fix
// may touch. The same keys are used for incident root causes (suspects.ts) and Spot the
// Difference options. Dangerous changes ("you opened port 22 to the world") are flagged.

import type { Board, Component, NaclRule, SgRule } from '../model';
import type { PolicyDocument } from '../iam/types';
import { allSubnets, targetLabel } from '../net/routing';
import { list } from '../iam/match';

export interface Change {
  /** e.g. "nacl:acl-app:outbound", "config:alb-3:healthCheck", "route:rtb-private-a:0.0.0.0/0" */
  key: string;
  desc: string;
  /** Set when the change weakens security or resilience on its own. */
  danger?: string;
}

const j = (v: unknown) => JSON.stringify(v ?? null);

/** Config fields that are really the component's resource policy. */
const POLICY_FIELDS: Record<string, string[]> = { s3: ['policy', 'customPolicy', 'policyDistributionId'], sqs: ['policyDoc'], vpce: ['policyDoc'] };

function sgRuleText(r: SgRule): string {
  const src = 'cidr' in r.source ? r.source.cidr : 'sg' in r.source ? r.source.sg : r.source.prefixList;
  const ports = r.protocol === 'all' ? 'all' : r.fromPort === r.toPort ? `${r.protocol} ${r.fromPort}` : `${r.protocol} ${r.fromPort}-${r.toPort}`;
  return `${ports} ${src}`;
}

function naclRuleText(r: NaclRule): string {
  return `#${r.ruleNumber} ${r.action} ${r.protocol} ${r.portRange[0]}-${r.portRange[1]} ${r.cidr}`;
}

function wildcardAdmin(doc: PolicyDocument | null | undefined): boolean {
  return !!doc?.Statement.some((s) => s.Effect === 'Allow' && list(s.Action).some((a) => a === '*' || a.endsWith(':*')) && list(s.Resource).includes('*'));
}

function denies(doc: PolicyDocument | null | undefined): number {
  return doc?.Statement.filter((s) => s.Effect === 'Deny').length ?? 0;
}

function resourcePolicyOf(c: Component): unknown {
  const cfg = c.config as unknown as Record<string, unknown>;
  return (POLICY_FIELDS[c.type] ?? []).map((f) => cfg[f]);
}

export function diffBoards(a: Board, b: Board): Change[] {
  const out: Change[] = [];

  // Components.
  for (const id of Object.keys(b.components)) if (!a.components[id]) out.push({ key: `add:${b.components[id].type}:${id}`, desc: `Added ${b.components[id].type.toUpperCase()} ${b.components[id].name}` });
  for (const id of Object.keys(a.components)) if (!b.components[id]) out.push({ key: `remove:${a.components[id].type}:${id}`, desc: `Deleted ${a.components[id].name}` });
  for (const id of Object.keys(a.components)) {
    const ca = a.components[id];
    const cb = b.components[id];
    if (!cb) continue;
    const fa = ca.config as unknown as Record<string, unknown>;
    const fb = cb.config as unknown as Record<string, unknown>;
    for (const f of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      if ((POLICY_FIELDS[cb.type] ?? []).includes(f) || j(fa[f]) === j(fb[f])) continue;
      const ch: Change = { key: `config:${id}:${f}`, desc: `${cb.name}: ${f} ${short(fa[f])} → ${short(fb[f])}` };
      if (f === 'publiclyAccessible' && fb[f] === true) ch.danger = `${cb.name} is now publicly accessible`;
      if (f === 'blockPublicAccess' && fb[f] === false) ch.danger = `Block Public Access turned off on ${cb.name}`;
      if (f === 'publicIp' && fb[f] === true) ch.danger = `${cb.name} instances now get public IPs`;
      out.push(ch);
    }
    if (j(resourcePolicyOf(ca)) !== j(resourcePolicyOf(cb))) {
      const ch: Change = { key: `resourcepolicy:${id}`, desc: `${cb.name}: resource policy changed` };
      const da = (fa.customPolicy ?? fa.policyDoc) as PolicyDocument | null | undefined;
      const db = (fb.customPolicy ?? fb.policyDoc) as PolicyDocument | null | undefined;
      if (denies(db) < denies(da)) ch.danger = `Removed a Deny guard from ${cb.name}'s policy`;
      if (fb.policy === 'public-read' || db?.Statement.some((s) => s.Effect === 'Allow' && s.Principal === '*' && !s.Condition)) ch.danger = `${cb.name}'s policy now allows anyone ("Principal": "*")`;
      out.push(ch);
    }
    if (j(ca.subnets) !== j(cb.subnets)) out.push({ key: `subnets:${id}`, desc: `${cb.name}: subnets ${short(ca.subnets)} → ${short(cb.subnets)}` });
    if (j(ca.securityGroupIds) !== j(cb.securityGroupIds)) out.push({ key: `sgs:${id}`, desc: `${cb.name}: security groups changed` });
    if (j(ca.roleId) !== j(cb.roleId)) out.push({ key: `role:${id}`, desc: `${cb.name}: IAM role ${ca.roleId ?? 'none'} → ${cb.roleId ?? 'none'}` });
    if (ca.name !== cb.name) out.push({ key: `name:${id}`, desc: `Renamed ${ca.name} → ${cb.name}` });
  }

  // Security groups.
  for (const id of new Set([...Object.keys(a.securityGroups), ...Object.keys(b.securityGroups)])) {
    const sa = a.securityGroups[id];
    const sb = b.securityGroups[id];
    for (const dir of ['inbound', 'outbound'] as const) {
      const ra = (sa?.[dir] ?? []).map(sgRuleText);
      const rb = (sb?.[dir] ?? []).map(sgRuleText);
      if (j([...ra].sort()) === j([...rb].sort())) continue;
      const added = rb.filter((r) => !ra.includes(r));
      const removed = ra.filter((r) => !rb.includes(r));
      const ch: Change = { key: `sg:${id}:${dir}`, desc: `${(sb ?? sa)!.name} ${dir}: ${[...added.map((r) => `+ ${r}`), ...removed.map((r) => `− ${r}`)].join(', ')}` };
      if (dir === 'inbound' && sb) {
        const owners = Object.values(b.components).filter((c) => c.securityGroupIds?.includes(id));
        const isAlb = owners.some((c) => c.type === 'alb');
        for (const r of sb.inbound) {
          if (!added.includes(sgRuleText(r)) || !('cidr' in r.source) || r.source.cidr !== '0.0.0.0/0') continue;
          const covers = (p: number) => r.protocol === 'all' || (r.fromPort <= p && r.toPort >= p);
          if (covers(22) || covers(3389)) ch.danger = `${sb.name} opens ${covers(22) ? 'SSH (22)' : 'RDP (3389)'} to the world`;
          else if (!isAlb) ch.danger = `${sb.name} (a private tier) now accepts ${sgRuleText(r)} from the whole internet`;
        }
      }
      out.push(ch);
    }
  }

  // NACLs.
  for (const id of new Set([...Object.keys(a.nacls), ...Object.keys(b.nacls)])) {
    for (const dir of ['inbound', 'outbound'] as const) {
      const ra = (a.nacls[id]?.[dir] ?? []).map(naclRuleText).sort();
      const rb = (b.nacls[id]?.[dir] ?? []).map(naclRuleText).sort();
      if (j(ra) === j(rb)) continue;
      const added = rb.filter((r) => !ra.includes(r));
      const removed = ra.filter((r) => !rb.includes(r));
      const ch: Change = { key: `nacl:${id}:${dir}`, desc: `${(b.nacls[id] ?? a.nacls[id]).name} ${dir}: ${[...added.map((r) => `+ ${r}`), ...removed.map((r) => `− ${r}`)].join(', ')}` };
      const wide = (b.nacls[id]?.[dir] ?? []).find((r) => added.includes(naclRuleText(r)) && r.action === 'allow' && r.protocol === 'all' && r.cidr === '0.0.0.0/0');
      if (wide && dir === 'inbound') ch.danger = `${b.nacls[id].name} now allows all traffic in from 0.0.0.0/0`;
      out.push(ch);
    }
  }

  // Routes.
  for (const id of new Set([...Object.keys(a.routeTables), ...Object.keys(b.routeTables)])) {
    const ra = Object.fromEntries((a.routeTables[id]?.routes ?? []).map((r) => [r.dest, targetLabel(r.target)]));
    const rb = Object.fromEntries((b.routeTables[id]?.routes ?? []).map((r) => [r.dest, targetLabel(r.target)]));
    for (const dest of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (ra[dest] === rb[dest]) continue;
      out.push({ key: `route:${id}:${dest}`, desc: `${(b.routeTables[id] ?? a.routeTables[id]).name}: ${dest} ${ra[dest] ?? '(none)'} → ${rb[dest] ?? '(deleted)'}` });
    }
  }

  // Subnet associations.
  const subsA = Object.fromEntries(allSubnets(a).map((s) => [s.id, s]));
  for (const s of allSubnets(b)) {
    const o = subsA[s.id];
    if (!o) continue;
    if (o.routeTableId !== s.routeTableId) out.push({ key: `subnet:${s.id}:routeTableId`, desc: `${s.name}: route table ${o.routeTableId} → ${s.routeTableId}` });
    if (o.naclId !== s.naclId) out.push({ key: `subnet:${s.id}:naclId`, desc: `${s.name}: network ACL ${o.naclId} → ${s.naclId}` });
  }

  // IAM.
  const ia = a.iam;
  const ib = b.iam;
  if (ia || ib) {
    const rolesA = ia?.roles ?? {};
    const rolesB = ib?.roles ?? {};
    for (const id of new Set([...Object.keys(rolesA), ...Object.keys(rolesB)])) {
      const x = rolesA[id];
      const y = rolesB[id];
      if (!x) {
        out.push({ key: `add:role:${id}`, desc: `Created ${y.kind} ${y.name}` });
        continue;
      }
      if (!y) {
        out.push({ key: `remove:role:${id}`, desc: `Deleted ${x.kind} ${x.name}` });
        continue;
      }
      if (j(x.policies) !== j(y.policies)) {
        const ch: Change = { key: `policy:${id}`, desc: `${y.name}: permission policies changed` };
        if (y.policies.some((p) => wildcardAdmin(p.doc)) && !x.policies.some((p) => wildcardAdmin(p.doc))) ch.danger = `${y.name} now has a wildcard Action with "Resource": "*" (far beyond least privilege)`;
        out.push(ch);
      }
      if (j(x.boundary) !== j(y.boundary)) out.push({ key: `boundary:${id}`, desc: `${y.name}: permissions boundary changed`, ...(x.boundary && !y.boundary ? { danger: `Removed the permissions boundary from ${y.name}` } : {}) });
      if (j(x.trust) !== j(y.trust)) out.push({ key: `trust:${id}`, desc: `${y.name}: trust policy changed` });
    }
    for (const id of new Set([...Object.keys(ia?.keys ?? {}), ...Object.keys(ib?.keys ?? {})])) {
      const x = ia?.keys[id];
      const y = ib?.keys[id];
      if (j(x?.policy) !== j(y?.policy)) {
        const ch: Change = { key: `keypolicy:${id}`, desc: `Key ${(y ?? x)!.alias}: key policy changed` };
        if (y && y.policy.Statement.some((s) => s.Effect === 'Allow' && (s.Principal === '*' || (typeof s.Principal === 'object' && list(s.Principal.AWS).includes('*'))) && !s.Condition)) ch.danger = `Key ${y.alias} can now be used by anyone`;
        out.push(ch);
      }
    }
    if (j(ia?.scps) !== j(ib?.scps)) out.push({ key: 'scp', desc: 'Service control policies changed' });
  }
  return out;
}

function short(v: unknown): string {
  if (v === undefined || v === null) return 'none';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  }
  return String(v);
}

export function keyMatches(key: string, allowed: string[]): boolean {
  return allowed.some((p) => key === p || key.startsWith(p.endsWith(':') ? p : p + ':') || (p.endsWith('*') && key.startsWith(p.slice(0, -1))));
}

/** Changes outside the allowed set (or dangerous ones) count as collateral. */
export function collateral(start: Board, now: Board, allowed: string[]): Change[] {
  return diffBoards(start, now).filter((c) => c.danger || !keyMatches(c.key, allowed));
}

