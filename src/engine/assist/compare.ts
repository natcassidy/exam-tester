// "What does the reference do differently?": the last rung of the hint ladder. Compares the
// player's board with the mission's reference design in plain sentences. Both boards come from the
// same layout, so subnets, route tables and network ACLs share ids; components are matched by type
// (same name first).

import type { Board, Component, SecurityGroup, ServiceType, SgRule } from '../model';
import type { PolicyDocument, Statement } from '../iam/types';
import { subnetsOf } from '../board';
import { findSubnet, targetId, targetKind } from '../net/routing';
import { sgHomes, sgLender, sgPorts } from '../net/sg';

export interface RefDifference {
  /** Short heading: the object the difference is about. */
  area: string;
  /** What the reference does, and what the player's board does instead. */
  text: string;
  /** Service types involved, to put the differences that matter for a failing check first. */
  types: ServiceType[];
  /** Object on the player's board to open, when there is one. */
  playerTarget?: string;
  /** A reference component the player has no counterpart for, one only the player has, or a setting that differs. */
  kind?: 'missing' | 'extra' | 'changed';
  /** The reference component the difference is about (id and name), when there is one. */
  refId?: string;
  refName?: string;
  /** The config field that differs (dotted for nested settings), for config differences. */
  field?: string;
}

const SKIP_CONFIG = new Set(['type', 'customPolicy', 'policyDoc']);

function pairComponents(player: Board, ref: Board): Map<string, Component | undefined> {
  const pairs = new Map<string, Component | undefined>();
  const used = new Set<string>();
  const refs = Object.values(ref.components);
  // Same type and name first, then same type in board order.
  for (const pass of [true, false])
    for (const r of refs) {
      if (pairs.get(r.id)) continue;
      const p = Object.values(player.components).find((c) => !used.has(c.id) && c.type === r.type && (!pass || c.name === r.name));
      if (p) {
        used.add(p.id);
        pairs.set(r.id, p);
      } else if (!pass) pairs.set(r.id, undefined);
    }
  return pairs;
}

function placement(b: Board, c: Component): string {
  if (c.placement.kind === 'edge') return 'the Global edge';
  if (c.placement.kind === 'region') return `Regional services in ${c.placement.refId}`;
  if (c.placement.kind === 'vpcAttach') return "the VPC's attachments";
  if (c.placement.kind === 'onprem') return 'the on-premises data centre';
  const subs = subnetsOf(c).map((s) => findSubnet(b, s)?.subnet).filter(Boolean);
  return subs.length ? `${subs.map((s) => s!.name).join(', ')}` : 'a subnet';
}

/**
 * A config value compared across boards: component ids on the reference side are mapped to the
 * player's component paired with them, so a renamed but correctly wired component isn't a difference.
 */
function token(v: unknown, toPlayer: (id: string) => string | undefined, isComponent: (id: string) => boolean): string {
  if (typeof v === 'string' && isComponent(v)) return `comp:${toPlayer(v) ?? `unpaired:${v}`}`;
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => token(x, toPlayer, isComponent)));
  if (v && typeof v === 'object') return JSON.stringify(Object.entries(v).map(([k, x]) => [k, token(x, toPlayer, isComponent)]));
  return JSON.stringify(v ?? null);
}

/** A config value in words, with component ids replaced by names. */
function show(b: Board, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return b.components[v]?.name ?? v;
  if (Array.isArray(v)) return v.length ? v.map((x) => show(b, x)).join(', ') : 'none';
  if (typeof v === 'object')
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined)
      .map(([k, x]) => `${words(k)} ${show(b, x)}`)
      .join(', ');
  return String(v);
}

/** Flatten one level so nested settings (health check, listener, scaling policy) compare field by field. */
function flat(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (SKIP_CONFIG.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out[`${k}.${k2}`] = v2;
    else out[k] = v;
  }
  return out;
}

const words = (k: string) => k.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** An SG rule in terms that survive different ids: "TCP 443 from web-alb's group". */
function ruleInRoles(b: Board, r: SgRule): { key: string; text: string } {
  const ports = sgPorts(r);
  if ('cidr' in r.source) return { key: `${ports}|cidr:${r.source.cidr}`, text: `${ports} from ${r.source.cidr}` };
  if ('prefixList' in r.source) return { key: `${ports}|pl:${r.source.prefixList}`, text: `${ports} from ${r.source.prefixList}` };
  const os = sgHomes(b, r.source.sg);
  const types = [...new Set(os.map((o) => o.type))].sort().join('+') || 'none';
  const sg = b.securityGroups[r.source.sg];
  return { key: `${ports}|sg:${types}`, text: `${ports} from ${os.length ? `${os.map((o) => o.name).join('/')}'s group (${sg?.name ?? r.source.sg})` : sg?.name ?? r.source.sg}` };
}

function sgDiffs(player: Board, ref: Board, rc: Component, pc: Component): RefDifference[] {
  const out: RefDifference[] = [];
  // A group this component borrowed from another one (it isn't the group's home).
  const borrowed = (b: Board, c: Component, sg: SecurityGroup) => (sgLender(b, c, sg.id) ? sgHomes(b, sg.id) : []);
  const rSgs = (rc.securityGroupIds ?? []).map((id) => ref.securityGroups[id]).filter(Boolean);
  const pSgs = (pc.securityGroupIds ?? []).map((id) => player.securityGroups[id]).filter(Boolean);
  // Groups borrowed from another tier (the classic: the load balancer's group on the app servers).
  for (const sg of pSgs) {
    const others = borrowed(player, pc, sg);
    const refBorrows = rSgs.some((r) => borrowed(ref, rc, r).some((o) => others.some((x) => x.type === o.type)));
    if (others.length && !refBorrows)
      out.push({
        area: pc.name,
        text: `${pc.name} carries ${sg.name}, ${others.map((o) => o.name).join(', ')}'s security group. In the reference, ${rc.name} only carries its own group${rSgs.length > 1 ? 's' : ''} (${rSgs.map((s) => s.name).join(', ')}).`,
        types: [pc.type, ...others.map((o) => o.type)],
        playerTarget: pc.id,
      });
  }
  // Inbound rules, compared by role.
  const rRules = rSgs.flatMap((sg) => sg.inbound.map((r) => ({ sg, ...ruleInRoles(ref, r) })));
  const pRules = pSgs.flatMap((sg) => sg.inbound.map((r) => ({ sg, ...ruleInRoles(player, r) })));
  for (const r of rRules)
    if (!pRules.some((p) => p.key === r.key))
      out.push({ area: `${pc.name} · inbound`, text: `The reference lets ${rc.name} accept ${r.text}. Nothing on ${pc.name} allows that.`, types: [pc.type], playerTarget: pSgs[0]?.id ?? pc.id });
  for (const p of pRules)
    if (!rRules.some((r) => r.key === p.key))
      out.push({ area: `${pc.name} · inbound`, text: `${p.sg.name} on ${pc.name} allows ${p.text}. The reference has no such rule.`, types: [pc.type], playerTarget: p.sg.id });
  // Outbound rules: "from" reads as "to" here.
  const rOut = rSgs.flatMap((sg) => sg.outbound.map((r) => ({ sg, ...ruleInRoles(ref, r) })));
  const pOut = pSgs.flatMap((sg) => sg.outbound.map((r) => ({ sg, ...ruleInRoles(player, r) })));
  const to = (t: string) => t.replace(' from ', ' to ');
  for (const r of rOut)
    if (!pOut.some((p) => p.key === r.key))
      out.push({ area: `${pc.name} · outbound`, text: `The reference lets ${rc.name} send ${to(r.text)}. Nothing on ${pc.name} allows that.`, types: [pc.type], playerTarget: pSgs[0]?.id ?? pc.id, field: 'securityGroups.outbound' });
  for (const p of pOut)
    if (!rOut.some((r) => r.key === p.key))
      out.push({ area: `${pc.name} · outbound`, text: `${p.sg.name} on ${pc.name} allows ${to(p.text)} out. The reference has no such rule.`, types: [pc.type], playerTarget: p.sg.id, field: 'securityGroups.outbound' });
  return out;
}

function componentDiffs(player: Board, ref: Board, rc: Component, pc: Component, pairs: Map<string, Component | undefined>): RefDifference[] {
  const out: RefDifference[] = [];
  const rSubs = subnetsOf(rc);
  const pSubs = subnetsOf(pc);
  if (rc.placement.kind !== pc.placement.kind || (rc.placement.kind !== 'subnet' && rc.placement.refId !== pc.placement.refId) || JSON.stringify([...rSubs].sort()) !== JSON.stringify([...pSubs].sort()))
    out.push({ area: pc.name, text: `The reference puts ${rc.name} in ${placement(ref, rc)}. Yours is in ${placement(player, pc)}.`, types: [pc.type], playerTarget: pc.id, field: 'placement' });
  const rf = flat(rc.config as unknown as Record<string, unknown>);
  const pf = flat(pc.config as unknown as Record<string, unknown>);
  const viaPairs = (id: string) => pairs.get(id)?.id;
  const isRef = (id: string) => !!ref.components[id];
  const isPlayer = (id: string) => !!player.components[id];
  for (const k of Object.keys(rf)) {
    const [rv, pv] = [rf[k], pf[k]];
    // Lists of settings (lifecycle transitions, DNS records, TGW route tables) compare item by item.
    const items = (v: unknown) => Array.isArray(v) && v.some((x) => x && typeof x === 'object');
    if (items(rv) && (items(pv) || !pv || (Array.isArray(pv) && !pv.length))) {
      const ra = rv as unknown[];
      const pa = (pv ?? []) as unknown[];
      for (let i = 0; i < Math.max(ra.length, pa.length); i++)
        if (token(ra[i], viaPairs, isRef) !== token(pa[i], (id) => id, isPlayer))
          out.push({ area: pc.name, text: `${pc.name} ${words(k)} #${i + 1}: the reference uses ${show(ref, ra[i])}, yours is ${show(player, pa[i])}.`, types: [pc.type], playerTarget: pc.id, field: `${k}.${i}` });
      continue;
    }
    const same = token(rv, viaPairs, isRef) === token(pv, (id) => id, isPlayer);
    if (!same) out.push({ area: pc.name, text: `${pc.name} ${words(k)}: the reference uses ${show(ref, rv)}, yours is ${show(player, pv)}.`, types: [pc.type], playerTarget: pc.id, field: k });
  }
  if ((rc.roleId ? ref.iam?.roles[rc.roleId]?.name : null) !== (pc.roleId ? player.iam?.roles[pc.roleId]?.name : null))
    out.push({ area: pc.name, text: `The reference gives ${rc.name} the role ${rc.roleId ? ref.iam?.roles[rc.roleId]?.name ?? rc.roleId : 'none'}; yours has ${pc.roleId ? player.iam?.roles[pc.roleId]?.name ?? pc.roleId : 'none'}.`, types: [pc.type], playerTarget: pc.id });
  out.push(...sgDiffs(player, ref, rc, pc).map((d) => ({ ...d, field: d.field ?? 'securityGroups.inbound' })));
  const rDoc = rc.config.type === 's3' ? rc.config.customPolicy : rc.config.type === 'sqs' ? rc.config.policyDoc : undefined;
  const pDoc = pc.config.type === 's3' ? pc.config.customPolicy : pc.config.type === 'sqs' ? pc.config.policyDoc : undefined;
  const field = rc.type === 's3' ? 'customPolicy' : 'policyDoc';
  if ((rc.type === 's3' || rc.type === 'sqs') && docKey(rDoc) !== docKey(pDoc)) out.push(...docDiffs(`${pc.name} · ${rc.type === 's3' ? 'bucket' : 'queue'} policy`, rDoc, pDoc).map((t) => ({ area: pc.name, text: t, types: [pc.type], playerTarget: pc.id, field })));
  return out.map((d) => ({ kind: 'changed' as const, refId: rc.id, refName: rc.name, ...d }));
}

function routeDiffs(player: Board, ref: Board): RefDifference[] {
  const out: RefDifference[] = [];
  const label = (b: Board, t: Parameters<typeof targetKind>[0]) => {
    const k = targetKind(t);
    if (k === 'local') return 'local';
    const c = b.components[targetId(t)!];
    const az = c?.placement.kind === 'subnet' ? findSubnet(b, c.placement.refId)?.subnet.azId : undefined;
    return c ? `${c.name}${k === 'nat' && az ? ` (${az})` : ''}` : `${k} (deleted)`;
  };
  const kindAz = (b: Board, t: Parameters<typeof targetKind>[0]) => {
    const k = targetKind(t);
    const c = k === 'local' ? undefined : b.components[targetId(t)!];
    return `${k}:${c?.placement.kind === 'subnet' ? findSubnet(b, c.placement.refId)?.subnet.azId ?? '' : ''}`;
  };
  for (const rt of Object.values(ref.routeTables)) {
    const prt = player.routeTables[rt.id];
    if (!prt) continue;
    for (const r of rt.routes) {
      if (r.propagated) continue;
      const p = prt.routes.find((x) => x.dest === r.dest);
      const types = [targetKind(r.target)].filter((k) => k !== 'local') as ServiceType[];
      if (!p) out.push({ area: rt.name, text: `The reference routes ${r.dest} → ${label(ref, r.target)} in ${rt.name}. Yours has no route for ${r.dest}.`, types, playerTarget: prt.id });
      else if (kindAz(ref, r.target) !== kindAz(player, p.target)) out.push({ area: rt.name, text: `${rt.name} ${r.dest}: the reference routes to ${label(ref, r.target)}, yours to ${label(player, p.target)}.`, types, playerTarget: prt.id });
    }
    for (const p of prt.routes)
      if (!p.propagated && !rt.routes.some((r) => r.dest === p.dest))
        out.push({ area: rt.name, text: `${rt.name} routes ${p.dest} → ${label(player, p.target)}. The reference has no such route.`, types: [targetKind(p.target)].filter((k) => k !== 'local') as ServiceType[], playerTarget: prt.id });
  }
  return out;
}

function naclDiffs(player: Board, ref: Board): RefDifference[] {
  const out: RefDifference[] = [];
  const txt = (r: { ruleNumber: number | string; action: string; protocol: string; portRange: [number, number]; cidr: string }) => `#${r.ruleNumber} ${r.action} ${r.protocol} ${r.portRange[0]}-${r.portRange[1]} ${r.cidr}`;
  for (const n of Object.values(ref.nacls)) {
    const p = player.nacls[n.id];
    if (!p) continue;
    for (const dir of ['inbound', 'outbound'] as const) {
      const a = n[dir].map(txt);
      const b = p[dir].map(txt);
      const missing = a.filter((x) => !b.includes(x));
      const extra = b.filter((x) => !a.includes(x));
      if (missing.length || extra.length)
        out.push({ area: n.name, text: `${n.name} ${dir}: ${[missing.length ? `the reference has ${missing.join('; ')}` : '', extra.length ? `yours also has ${extra.join('; ')}` : ''].filter(Boolean).join(', ')}.`, types: [], playerTarget: p.id });
    }
  }
  return out;
}

// ----- Policies -----

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? [...v].sort() : [v]);

/** A statement in one line: "Allow s3:GetObject on arn:aws:s3:::reports/*". */
function stmtText(s: Statement): string {
  const who = s.Principal === undefined ? '' : s.Principal === '*' ? ' for anyone' : ` for ${[...list(s.Principal.AWS), ...list(s.Principal.Service)].join(', ')}`;
  const what = s.Action !== undefined ? list(s.Action).join(', ') : `everything except ${list(s.NotAction).join(', ')}`;
  const on = s.Resource !== undefined ? list(s.Resource).join(', ') : s.NotResource !== undefined ? `everything except ${list(s.NotResource).join(', ')}` : '';
  const when = s.Condition ? ` when ${JSON.stringify(s.Condition)}` : '';
  return `${s.Effect} ${what}${on ? ` on ${on}` : ''}${who}${when}`;
}

const docKey = (d: PolicyDocument | null | undefined) => (d ? d.Statement.map(stmtText).sort().join(' | ') : '');

/** Statements one document has and the other doesn't, in words. */
function docDiffs(what: string, ref: PolicyDocument | null | undefined, player: PolicyDocument | null | undefined): string[] {
  const r = (ref?.Statement ?? []).map(stmtText);
  const p = (player?.Statement ?? []).map(stmtText);
  const out: string[] = [];
  for (const x of r) if (!p.includes(x)) out.push(`${what}: the reference has "${x}". Yours doesn't.`);
  for (const x of p) if (!r.includes(x)) out.push(`${what}: yours has "${x}". The reference doesn't.`);
  return out;
}

/** Roles and users (matched by name), their policies, boundaries and trust; KMS key policies (by alias); SCPs. */
function iamDiffs(player: Board, ref: Board): RefDifference[] {
  const out: RefDifference[] = [];
  const rIam = ref.iam;
  const pIam = player.iam;
  const rRoles = Object.values(rIam?.roles ?? {});
  const pRoles = Object.values(pIam?.roles ?? {});
  const diff = (refName: string, text: string, playerTarget?: string, kind: RefDifference['kind'] = 'changed'): RefDifference => ({ area: refName, text, types: [], playerTarget, kind, refName });
  for (const r of rRoles) {
    const p = pRoles.find((x) => x.name === r.name && x.kind === r.kind);
    if (!p) {
      out.push(diff(r.name, `The reference has the ${r.kind} ${r.name}${r.policies.length ? ` (${r.policies.map((x) => x.name).join(', ')})` : ''}. Your board has none.`, undefined, 'missing'));
      continue;
    }
    for (const rp of r.policies) {
      const pp = p.policies.find((x) => x.name === rp.name);
      if (!pp && p.policies.length === 1 && r.policies.length === 1) out.push(...docDiffs(`${r.name} · ${p.policies[0].name}`, rp.doc, p.policies[0].doc).map((t) => diff(r.name, t, p.id)));
      else if (!pp) out.push(diff(r.name, `The reference gives ${r.name} the policy ${rp.name}: ${rp.doc.Statement.map(stmtText).join('; ')}. Yours has no policy by that name.`, p.id));
      else if (docKey(rp.doc) !== docKey(pp.doc)) out.push(...docDiffs(`${r.name} · ${rp.name}`, rp.doc, pp.doc).map((t) => diff(r.name, t, p.id)));
    }
    if (!(p.policies.length === 1 && r.policies.length === 1))
      for (const pp of p.policies) if (!r.policies.some((x) => x.name === pp.name)) out.push(diff(r.name, `${r.name} has the policy ${pp.name}: ${pp.doc.Statement.map(stmtText).join('; ')}. The reference doesn't.`, p.id));
    if (docKey(r.boundary) !== docKey(p.boundary)) out.push(...docDiffs(`${r.name} · permissions boundary`, r.boundary, p.boundary).map((t) => diff(r.name, t, p.id)));
    if (docKey(r.trust) !== docKey(p.trust)) out.push(...docDiffs(`${r.name} · trust policy`, r.trust, p.trust).map((t) => diff(r.name, t, p.id)));
  }
  for (const p of pRoles) if (!rRoles.some((r) => r.name === p.name && r.kind === p.kind)) out.push({ area: p.name, text: `Your board has the ${p.kind} ${p.name}. The reference doesn't.`, types: [], playerTarget: p.id, kind: 'extra' });
  for (const k of Object.values(rIam?.keys ?? {})) {
    const p = Object.values(pIam?.keys ?? {}).find((x) => x.alias === k.alias);
    if (!p) out.push(diff(k.alias, `The reference has the KMS key ${k.alias}. Your board has none.`, undefined, 'missing'));
    else if (docKey(k.policy) !== docKey(p.policy)) out.push(...docDiffs(`key ${k.alias} · key policy`, k.policy, p.policy).map((t) => diff(k.alias, t, p.id)));
  }
  const scps = (b: Board) => (b.iam?.scps ?? []).flatMap((x) => x.doc.Statement);
  const rScp = scps(ref).map(stmtText);
  const pScp = scps(player).map(stmtText);
  for (const x of rScp) if (!pScp.includes(x)) out.push(diff('SCPs', `SCPs: the reference has "${x}". Yours doesn't.`));
  for (const x of pScp) if (!rScp.includes(x)) out.push(diff('SCPs', `SCPs: yours has "${x}". The reference doesn't.`));
  return out;
}

/** The player's component paired with each reference component (by id), for marking both boards. */
export function referencePairs(player: Board, ref: Board): Map<string, string | undefined> {
  return new Map([...pairComponents(player, ref)].map(([r, p]) => [r, p?.id]));
}

export function compareToReference(player: Board, ref: Board): RefDifference[] {
  const out: RefDifference[] = [];
  const pairs = pairComponents(player, ref);
  for (const [rid, pc] of pairs) {
    const rc = ref.components[rid];
    if (!pc) out.push({ area: rc.name, text: `The reference has ${rc.name} (${rc.type.toUpperCase()}) in ${placement(ref, rc)}. Your board has none.`, types: [rc.type], kind: 'missing', refId: rc.id, refName: rc.name });
    else out.push(...componentDiffs(player, ref, rc, pc, pairs));
  }
  const paired = new Set([...pairs.values()].filter(Boolean).map((c) => c!.id));
  for (const c of Object.values(player.components))
    if (!paired.has(c.id)) out.push({ area: c.name, text: `Your board has ${c.name} (${c.type.toUpperCase()}). The reference doesn't use one.`, types: [c.type], playerTarget: c.id, kind: 'extra' });
  out.push(...routeDiffs(player, ref), ...naclDiffs(player, ref), ...iamDiffs(player, ref));
  return out;
}

/** Split differences into the ones about the failing check's components and the rest. */
export function relevantFirst(diffs: RefDifference[], types: ServiceType[]): { relevant: RefDifference[]; other: RefDifference[] } {
  if (!types.length) return { relevant: diffs, other: [] };
  const relevant = diffs.filter((d) => d.types.some((t) => types.includes(t)));
  return relevant.length ? { relevant, other: diffs.filter((d) => !relevant.includes(d)) } : { relevant: diffs, other: [] };
}
