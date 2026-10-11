// "What does the reference do differently?": the last rung of the hint ladder. Compares the
// player's board with the mission's reference design in plain sentences. Both boards come from the
// same layout, so subnets, route tables and network ACLs share ids; components are matched by type
// (same name first).

import type { Board, Component, SecurityGroup, ServiceType, SgRule } from '../model';
import { subnetsOf } from '../board';
import { findSubnet, targetId, targetKind } from '../net/routing';

export interface RefDifference {
  /** Short heading: the object the difference is about. */
  area: string;
  /** What the reference does, and what the player's board does instead. */
  text: string;
  /** Service types involved, to put the differences that matter for a failing check first. */
  types: ServiceType[];
  /** Object on the player's board to open, when there is one. */
  playerTarget?: string;
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

/** A config value in words, with component ids replaced by names. */
function show(b: Board, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return b.components[v]?.name ?? v;
  if (Array.isArray(v)) return v.length ? v.map((x) => show(b, x)).join(', ') : 'none';
  if (typeof v === 'object') return JSON.stringify(v);
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

/** Who carries a security group, as types (stable across boards) and names (for display). */
function owners(b: Board, sgId: string): Component[] {
  return Object.values(b.components).filter((c) => c.securityGroupIds?.includes(sgId));
}

/** The components a group belongs to: those that carry it as their first group (the one created with them). Others borrowed it. */
function homes(b: Board, sgId: string): Component[] {
  const all = owners(b, sgId);
  const first = all.filter((c) => c.securityGroupIds![0] === sgId);
  return first.length ? first : all;
}

/** An SG rule in terms that survive different ids: "TCP 443 from web-alb's group". */
function ruleInRoles(b: Board, r: SgRule): { key: string; text: string } {
  const ports = r.protocol === 'all' ? 'all traffic' : `${r.protocol.toUpperCase()} ${r.fromPort === r.toPort ? r.fromPort : `${r.fromPort}-${r.toPort}`}`;
  if ('cidr' in r.source) return { key: `${ports}|cidr:${r.source.cidr}`, text: `${ports} from ${r.source.cidr}` };
  if ('prefixList' in r.source) return { key: `${ports}|pl:${r.source.prefixList}`, text: `${ports} from ${r.source.prefixList}` };
  const os = homes(b, r.source.sg);
  const types = [...new Set(os.map((o) => o.type))].sort().join('+') || 'none';
  const sg = b.securityGroups[r.source.sg];
  return { key: `${ports}|sg:${types}`, text: `${ports} from ${os.length ? `${os.map((o) => o.name).join('/')}'s group (${sg?.name ?? r.source.sg})` : sg?.name ?? r.source.sg}` };
}

function sgDiffs(player: Board, ref: Board, rc: Component, pc: Component): RefDifference[] {
  const out: RefDifference[] = [];
  // A group this component borrowed from another one (it isn't the group's home).
  const borrowed = (b: Board, c: Component, sg: SecurityGroup) => (homes(b, sg.id).some((h) => h.id === c.id) ? [] : homes(b, sg.id));
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
  return out;
}

function componentDiffs(player: Board, ref: Board, rc: Component, pc: Component): RefDifference[] {
  const out: RefDifference[] = [];
  const rSubs = subnetsOf(rc);
  const pSubs = subnetsOf(pc);
  if (rc.placement.kind !== pc.placement.kind || (rc.placement.kind !== 'subnet' && rc.placement.refId !== pc.placement.refId) || JSON.stringify([...rSubs].sort()) !== JSON.stringify([...pSubs].sort()))
    out.push({ area: pc.name, text: `The reference puts ${rc.name} in ${placement(ref, rc)}. Yours is in ${placement(player, pc)}.`, types: [pc.type], playerTarget: pc.id });
  const rf = flat(rc.config as unknown as Record<string, unknown>);
  const pf = flat(pc.config as unknown as Record<string, unknown>);
  for (const k of Object.keys(rf)) {
    const a = show(ref, rf[k]);
    const b = show(player, pf[k]);
    if (a !== b) out.push({ area: pc.name, text: `${pc.name} ${words(k)}: the reference uses ${a}, yours is ${b}.`, types: [pc.type], playerTarget: pc.id });
  }
  if ((rc.roleId ? ref.iam?.roles[rc.roleId]?.name : null) !== (pc.roleId ? player.iam?.roles[pc.roleId]?.name : null))
    out.push({ area: pc.name, text: `The reference gives ${rc.name} the role ${rc.roleId ? ref.iam?.roles[rc.roleId]?.name ?? rc.roleId : 'none'}; yours has ${pc.roleId ? player.iam?.roles[pc.roleId]?.name ?? pc.roleId : 'none'}.`, types: [pc.type], playerTarget: pc.id });
  out.push(...sgDiffs(player, ref, rc, pc));
  return out;
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

export function compareToReference(player: Board, ref: Board): RefDifference[] {
  const out: RefDifference[] = [];
  const pairs = pairComponents(player, ref);
  for (const [rid, pc] of pairs) {
    const rc = ref.components[rid];
    if (!pc) out.push({ area: rc.name, text: `The reference has ${rc.name} (${rc.type.toUpperCase()}) in ${placement(ref, rc)}. Your board has none.`, types: [rc.type] });
    else out.push(...componentDiffs(player, ref, rc, pc));
  }
  const paired = new Set([...pairs.values()].filter(Boolean).map((c) => c!.id));
  for (const c of Object.values(player.components))
    if (!paired.has(c.id)) out.push({ area: c.name, text: `Your board has ${c.name} (${c.type.toUpperCase()}). The reference doesn't use one.`, types: [c.type], playerTarget: c.id });
  out.push(...routeDiffs(player, ref), ...naclDiffs(player, ref));
  return out;
}

/** Split differences into the ones about the failing check's components and the rest. */
export function relevantFirst(diffs: RefDifference[], types: ServiceType[]): { relevant: RefDifference[]; other: RefDifference[] } {
  if (!types.length) return { relevant: diffs, other: [] };
  const relevant = diffs.filter((d) => d.types.some((t) => types.includes(t)));
  return relevant.length ? { relevant, other: diffs.filter((d) => !relevant.includes(d)) } : { relevant: diffs, other: [] };
}
