// Packet tracer: follows a flow hop by hop using real VPC semantics.

import type { Board, Component, ConfigOf, Endpoint, Flow, Hop, PathVia, Protocol, SecurityGroup, Trace, TgwRouteTable } from '../model';
import { eniIp, pcxConnects, regionOf, regionOfVpc, subnetsOf, vpcById } from '../board';
import { evaluateNacl, RETURN_PORT } from './nacl';
import { describeSgRule, evaluateSgs } from './sg';
import { findSubnet, INTERNET_IP, resolveRoute, SERVICE_IPS, targetId, targetKind } from './routing';
import { cidrContainsIp, hostIp, isValidCidr, parseCidr } from './cidr';
import { CITIES, cityRtt, regionName } from './geo';
import { resolveDns } from './dns';

export interface TraceOptions {
  failedAzs?: string[];
  /** Regions that are completely down (Stage 3). */
  failedRegions?: string[];
  /** VPN or Direct Connect connections (component ids) that are down. */
  failedLinks?: string[];
}

export interface Eni {
  comp: Component;
  subnetId: string;
  azId: string;
  ip: string;
  sgIds: string[];
  publicIp: boolean;
}

type External = { kind: 'external'; ip: string; label: string; service?: 's3' | 'dynamodb'; onprem?: boolean };

interface LegResult {
  ok: boolean;
  hops: Hop[];
  returnHops: Hop[];
  via: PathVia;
  /** VPN or DX connection that carried the flow. */
  linkId?: string;
}

// ---------- ENIs ----------

/** Instances an ASG has in each of its subnets (spread evenly, AZ-balanced like AWS). */
export function asgSpread(c: Component, failedAzs: string[] = [], board?: Board): Record<string, number> {
  const cfg = c.config as ConfigOf<'asg'>;
  const subs = subnetsOf(c).filter((s) => !board || !failedAzs.includes(findSubnet(board, s)?.subnet.azId ?? ''));
  const out: Record<string, number> = {};
  subs.forEach((s, i) => (out[s] = Math.floor(cfg.desired / subs.length) + (i < cfg.desired % subs.length ? 1 : 0)));
  return out;
}

/** The subnet holding the RDS primary. After an AZ failure, Multi-AZ fails over to the standby. */
export function rdsPrimarySubnet(board: Board, c: Component, failedAzs: string[] = []): string | null {
  const cfg = c.config as ConfigOf<'rds'> | ConfigOf<'aurora'>;
  const subs = subnetsOf(c);
  const primary = subs[0];
  const az = findSubnet(board, primary)?.subnet.azId;
  if (!az || !failedAzs.includes(az)) return primary;
  // Aurora storage spans three AZs, so a writer can always be brought up elsewhere.
  if (cfg.type === 'rds' && !cfg.multiAz) return null;
  return subs.find((s) => !failedAzs.includes(findSubnet(board, s)?.subnet.azId ?? '')) ?? null;
}

export function enisOf(board: Board, c: Component, failedAzs: string[] = [], failedRegions: string[] = []): Eni[] {
  if (c.placement.kind !== 'subnet') return [];
  if (failedRegions.length && failedRegions.includes(regionOf(board, c))) return [];
  let subs = subnetsOf(c);
  if (c.type === 'rds' || c.type === 'aurora') {
    const p = rdsPrimarySubnet(board, c, failedAzs);
    subs = p ? [p] : [];
  }
  if (c.type === 'asg') {
    const spread = asgSpread(c);
    subs = subs.filter((s) => spread[s] > 0);
  }
  const pub = (() => {
    const cfg = c.config;
    if (cfg.type === 'ec2' || cfg.type === 'asg') return cfg.publicIp;
    if (cfg.type === 'rds' || cfg.type === 'aurora') return cfg.publiclyAccessible;
    if (cfg.type === 'alb') return cfg.scheme === 'internet-facing';
    if (cfg.type === 'nat') return true;
    return false;
  })();
  return subs
    .map((sid) => {
      const f = findSubnet(board, sid);
      if (!f) return null;
      return { comp: c, subnetId: sid, azId: f.subnet.azId, ip: eniIp(board, c, sid), sgIds: c.securityGroupIds ?? [], publicIp: pub } as Eni;
    })
    .filter((e): e is Eni => !!e && !failedAzs.includes(e.azId));
}

function sgs(board: Board, ids: string[]): SecurityGroup[] {
  return ids.map((id) => board.securityGroups[id]).filter(Boolean);
}

function sgNames(board: Board, ids: string[]): string {
  return sgs(board, ids).map((s) => s.name).join(', ') || 'no security group';
}

const proto = (p: Protocol, port: number) => (p === 'all' ? 'all traffic' : `${p.toUpperCase()} ${port}`);

// ---------- Individual checks ----------

function sgCheck(board: Board, eni: Eni, dir: 'inbound' | 'outbound', p: Protocol, port: number, peer: { ip: string; sgIds: string[]; label: string }): Hop {
  const d = evaluateSgs(sgs(board, eni.sgIds), dir, p, port, { ip: peer.ip, sgIds: peer.sgIds });
  const check = dir === 'inbound' ? 'sg-in' : 'sg-out';
  if (d.allowed) {
    return {
      at: { kind: 'sg', id: d.matched!.sgId },
      check,
      result: 'allow',
      matched: { objectId: d.matched!.sgId, ruleRef: `${dir} rule #${d.matched!.ruleIndex + 1}` },
      explain: `${board.securityGroups[d.matched!.sgId].name} ${dir} allows ${describeSgRule(board, d.matched!.rule)} ${dir === 'inbound' ? 'from' : 'to'} ${peer.label}.`,
    };
  }
  return {
    at: { kind: 'sg', id: eni.sgIds[0] ?? eni.comp.id },
    check,
    result: 'deny',
    matched: eni.sgIds[0] ? { objectId: eni.sgIds[0], ruleRef: `${dir} rules` } : undefined,
    explain: `No ${dir} rule in ${sgNames(board, eni.sgIds)} (on ${eni.comp.name}) allows ${proto(p, port)} ${dir === 'inbound' ? 'from' : 'to'} ${peer.label}. Security groups deny anything not explicitly allowed.`,
  };
}

function naclCheck(board: Board, subnetId: string, dir: 'inbound' | 'outbound', p: Protocol, port: number, peerIp: string, peerLabel: string, isReturn = false): Hop {
  const f = findSubnet(board, subnetId)!;
  const nacl = board.nacls[f.subnet.naclId];
  const check = dir === 'inbound' ? 'nacl-in' : 'nacl-out';
  if (!nacl) return { at: { kind: 'subnet', id: subnetId }, check, result: 'deny', explain: `Subnet ${f.subnet.name} has no network ACL.` };
  const d = evaluateNacl(nacl, dir, p, port, peerIp);
  const portText = isReturn ? `the return traffic (${p.toUpperCase()} ephemeral port ${port}, range 1024-65535)` : proto(p, port);
  const ruleRef = d.ruleNumber === '*' ? `${dir} rule *` : `${dir} rule #${d.ruleNumber}`;
  if (d.action === 'allow') {
    return {
      at: { kind: 'nacl', id: nacl.id },
      check,
      result: 'allow',
      matched: { objectId: nacl.id, ruleRef },
      explain: `${nacl.name} (${f.subnet.name}) ${ruleRef} allows ${portText} ${dir === 'inbound' ? 'from' : 'to'} ${peerLabel}.`,
    };
  }
  const why =
    d.ruleNumber === '*'
      ? `No ${dir} rule matched, so the implicit * rule denied it.${isReturn ? ' NACLs are stateless: return traffic needs its own rule for ephemeral ports 1024-65535.' : ''}`
      : `Rule #${d.ruleNumber} denies it (rules are evaluated lowest number first; first match wins).`;
  return {
    at: { kind: 'nacl', id: nacl.id },
    check,
    result: 'deny',
    matched: { objectId: nacl.id, ruleRef },
    explain: `${nacl.name} (${f.subnet.name}) blocked ${portText} ${dir === 'inbound' ? 'from' : 'to'} ${peerLabel}. ${why}`,
  };
}

// ---------- Legs ----------

/** ENI to ENI (same VPC) or ENI to an external IP. */
function leg(board: Board, src: Eni, dst: Eni | External, p: Protocol, port: number, opts: TraceOptions): LegResult {
  const hops: Hop[] = [];
  const returnHops: Hop[] = [];
  const failed = opts.failedAzs ?? [];
  const dstIp = dst.ip;
  const dstLabel = 'kind' in dst ? dst.label : `${dst.comp.name} (${dst.ip})`;
  const srcLabel = `${src.comp.name} (${src.ip})`;
  const fail = (via: PathVia = 'none'): LegResult => ({ ok: false, hops, returnHops, via });

  const sgOut = sgCheck(board, src, 'outbound', p, port, { ip: dstIp, sgIds: 'kind' in dst ? [] : dst.sgIds, label: dstLabel });
  hops.push(sgOut);
  if (sgOut.result === 'deny') return fail();

  const sameSubnet = !('kind' in dst) && dst.subnetId === src.subnetId;
  if (!sameSubnet) {
    const n = naclCheck(board, src.subnetId, 'outbound', p, port, dstIp, dstLabel);
    hops.push(n);
    if (n.result === 'deny') return fail();
  }

  const srcSubnet = findSubnet(board, src.subnetId)!.subnet;
  const rt = board.routeTables[srcSubnet.routeTableId];
  const match = rt ? resolveRoute(board, rt.id, dstIp) : null;
  if (!match) {
    hops.push({
      at: { kind: 'routeTable', id: srcSubnet.routeTableId },
      check: 'route',
      result: 'deny',
      matched: { objectId: srcSubnet.routeTableId, ruleRef: 'routes' },
      explain: `No route to ${dstIp} in ${rt?.name ?? srcSubnet.routeTableId}. Without a matching route the packet is dropped.`,
    });
    return fail();
  }
  const kind = targetKind(match.route.target);
  const tId = targetId(match.route.target);
  const routeHop = (result: 'allow' | 'deny', extra = ''): Hop => ({
    at: { kind: 'routeTable', id: rt!.id },
    check: 'route',
    result,
    matched: { objectId: rt!.id, ruleRef: `route ${match.route.dest}` },
    explain: `${rt!.name}: longest-prefix match for ${dstIp} is ${match.route.dest} → ${kind === 'local' ? 'local' : board.components[tId!]?.name ?? `${tId} (deleted)`}.${extra}`,
  });

  let via: PathVia = 'local';

  if (kind === 'local') {
    if ('kind' in dst) {
      hops.push(routeHop('deny', ' Nothing in the VPC has that address.'));
      return fail();
    }
    const dVpc = findSubnet(board, dst.subnetId)!.vpc;
    const sVpc = findSubnet(board, src.subnetId)!.vpc;
    if (dVpc.id !== sVpc.id) {
      hops.push(routeHop('deny', ` ${dstIp} is inside this VPC's own CIDR (${sVpc.cidr}), so the local route catches it, but ${dst.comp.name} lives in ${dVpc.name ?? dVpc.id} (${dVpc.cidr}). Overlapping CIDRs can never be routed to each other: re-address one VPC.`));
      return fail();
    }
    hops.push(routeHop('allow'));
  } else {
    const target = tId ? board.components[tId] : undefined;
    if (!target) {
      hops.push(routeHop('deny', ` The target no longer exists, so this is a blackhole route.`));
      return fail();
    }
    if (kind === 'pcx' || kind === 'tgw' || kind === 'vgw') {
      hops.push(routeHop('allow'));
      return crossVpc(board, src, dst, kind, target, hops, p, port, opts);
    }
    if ('kind' in dst && dst.onprem) {
      hops.push(routeHop('deny', ` ${dstLabel} is a private on-premises address: it isn't reachable over the internet. Route the on-premises CIDR to a virtual private gateway or transit gateway with a VPN or Direct Connect connection.`));
      return fail();
    }
    if (!('kind' in dst)) {
      hops.push(routeHop('deny', ` That target leads out of the VPC, but ${dstLabel} is inside it.`));
      return fail();
    }
    hops.push(routeHop('allow'));

    if (kind === 'igw') {
      via = 'igw';
      if (!src.publicIp) {
        hops.push({
          at: { kind: 'component', id: src.comp.id },
          check: 'public-ip',
          result: 'deny',
          explain: `${src.comp.name} has no public IPv4 address. An internet gateway only translates traffic for interfaces with a public IP or Elastic IP. Private instances reach the internet through a NAT gateway.`,
        });
        return fail(via);
      }
      hops.push({ at: { kind: 'igw', id: target.id }, check: 'igw', result: 'allow', explain: `${target.name} translates ${src.ip} to its public IP and sends the packet to ${dstLabel}.` });
      const r = naclCheck(board, src.subnetId, 'inbound', p === 'all' ? 'all' : p, RETURN_PORT, dstIp, dstLabel, true);
      returnHops.push({ at: { kind: 'internet', id: 'internet' }, check: 'sg-in', result: 'info', explain: `Security groups are stateful: the response to ${src.comp.name} is allowed automatically.` });
      returnHops.push(r);
      return { ok: r.result !== 'deny', hops, returnHops, via };
    }

    if (kind === 'nat') {
      via = 'nat';
      const natSub = findSubnet(board, target.placement.refId);
      if (!natSub) return fail(via);
      if (failed.includes(natSub.subnet.azId)) {
        hops.push({ at: { kind: 'nat', id: target.id }, check: 'nat', result: 'deny', explain: `${target.name} lives in ${natSub.subnet.azId}, which has failed. NAT gateways are AZ-scoped: subnets routed to it lose outbound access.` });
        return fail(via);
      }
      const crossing = natSub.subnet.id !== src.subnetId;
      if (crossing) {
        const n1 = naclCheck(board, natSub.subnet.id, 'inbound', p, port, src.ip, srcLabel);
        hops.push(n1);
        if (n1.result === 'deny') return fail(via);
      }
      const natRt = board.routeTables[natSub.subnet.routeTableId];
      const natRoute = natRt ? resolveRoute(board, natRt.id, dstIp) : null;
      const natIgw = natRoute && targetKind(natRoute.route.target) === 'igw' ? board.components[targetId(natRoute.route.target)!] : undefined;
      if (!natIgw) {
        hops.push({
          at: { kind: 'nat', id: target.id },
          check: 'nat',
          result: 'deny',
          matched: natRt ? { objectId: natRt.id, ruleRef: 'route 0.0.0.0/0' } : undefined,
          explain: `${target.name} sits in ${natSub.subnet.name}, whose route table (${natRt?.name}) has no route to an internet gateway. A NAT gateway must live in a public subnet.`,
        });
        return fail(via);
      }
      hops.push({ at: { kind: 'nat', id: target.id }, check: 'nat', result: 'allow', explain: `${target.name} (in ${natSub.subnet.name}) translates ${src.ip} to its Elastic IP and forwards via ${natIgw.name}.` });
      const n2 = naclCheck(board, natSub.subnet.id, 'outbound', p, port, dstIp, dstLabel);
      hops.push(n2);
      if (n2.result === 'deny') return fail(via);
      hops.push({ at: { kind: 'igw', id: natIgw.id }, check: 'igw', result: 'allow', explain: `${natIgw.name} sends the packet to ${dstLabel}.` });
      // Return path: internet -> NAT subnet NACL in -> NAT subnet NACL out -> source NACL in.
      returnHops.push({ at: { kind: 'sg', id: src.sgIds[0] ?? src.comp.id }, check: 'sg-in', result: 'info', explain: `Security groups are stateful: the response to ${src.comp.name} is allowed automatically.` });
      const r1 = naclCheck(board, natSub.subnet.id, 'inbound', p, RETURN_PORT, dstIp, dstLabel, true);
      returnHops.push(r1);
      if (r1.result === 'deny') return { ok: false, hops, returnHops, via };
      if (crossing) {
        const r2 = naclCheck(board, natSub.subnet.id, 'outbound', p, RETURN_PORT, src.ip, srcLabel, true);
        returnHops.push(r2);
        if (r2.result === 'deny') return { ok: false, hops, returnHops, via };
        const r3 = naclCheck(board, src.subnetId, 'inbound', p, RETURN_PORT, dstIp, dstLabel, true);
        returnHops.push(r3);
        if (r3.result === 'deny') return { ok: false, hops, returnHops, via };
      }
      return { ok: true, hops, returnHops, via };
    }

    if (kind === 'vpce') {
      via = 'vpce';
      const cfg = target.config as ConfigOf<'vpce'>;
      if (dst.service !== cfg.service) {
        hops.push({ at: { kind: 'vpce', id: target.id }, check: 'vpce', result: 'deny', explain: `${target.name} is a gateway endpoint for ${cfg.service}, not for ${dst.label}.` });
        return fail(via);
      }
      hops.push({
        at: { kind: 'vpce', id: target.id },
        check: 'vpce',
        result: 'allow',
        explain: `${target.name} is associated with ${rt!.name}, so traffic to the ${cfg.service.toUpperCase()} prefix list stays on the AWS network. No NAT, no internet gateway, no data processing charge.`,
      });
      returnHops.push({ at: { kind: 'sg', id: src.sgIds[0] ?? src.comp.id }, check: 'sg-in', result: 'info', explain: `Security groups are stateful: the response is allowed automatically.` });
      const r = naclCheck(board, src.subnetId, 'inbound', p, RETURN_PORT, dstIp, dst.label, true);
      returnHops.push(r);
      return { ok: r.result !== 'deny', hops, returnHops, via };
    }

    hops.push({ at: { kind: 'routeTable', id: rt!.id }, check: 'route', result: 'deny', explain: `${kind} targets are not modelled.` });
    return fail();
  }

  // Arriving at a destination ENI inside the VPC.
  const d = dst as Eni;
  if (!sameSubnet) {
    const n = naclCheck(board, d.subnetId, 'inbound', p, port, src.ip, srcLabel);
    hops.push(n);
    if (n.result === 'deny') return fail(via);
  }
  const sgIn = sgCheck(board, d, 'inbound', p, port, { ip: src.ip, sgIds: src.sgIds, label: `${srcLabel} [${sgNames(board, src.sgIds)}]` });
  hops.push(sgIn);
  if (sgIn.result === 'deny') return fail(via);

  returnHops.push({ at: { kind: 'sg', id: d.sgIds[0] ?? d.comp.id }, check: 'sg-out', result: 'info', explain: `Security groups are stateful: ${d.comp.name}'s response is allowed out automatically, whatever its outbound rules say.` });
  if (!sameSubnet) {
    const r1 = naclCheck(board, d.subnetId, 'outbound', p, RETURN_PORT, src.ip, srcLabel, true);
    returnHops.push(r1);
    if (r1.result === 'deny') return { ok: false, hops, returnHops, via };
    const r2 = naclCheck(board, src.subnetId, 'inbound', p, RETURN_PORT, d.ip, dstLabel, true);
    returnHops.push(r2);
    if (r2.result === 'deny') return { ok: false, hops, returnHops, via };
  } else {
    returnHops.push({ at: { kind: 'subnet', id: d.subnetId }, check: 'nacl-in', result: 'info', explain: 'Same subnet: traffic never crosses the subnet boundary, so NACLs are not evaluated.' });
  }
  return { ok: true, hops, returnHops, via };
}

// ---------- Between VPCs and to on-premises (Stage 3) ----------

const ONPREM_HOST = 10;

export function onpremIp(board: Board): string {
  return board.onprem ? hostIp(board.onprem.cidr, ONPREM_HOST) : '192.168.0.10';
}

function vpcLabel(board: Board, vpcId: string): string {
  const v = vpcById(board, vpcId);
  return v ? `${v.name ?? v.id} (${v.cidr})` : vpcId;
}

/** VPN and DX connections on a gateway that are up, Direct Connect first (AWS prefers DX routes over VPN for the same prefix). */
export function linksOn(board: Board, gatewayId: string, failedLinks: string[] = []): Component[] {
  return Object.values(board.components)
    .filter((c) => (c.config.type === 'vpn' || c.config.type === 'dx') && c.config.attachTo === gatewayId && !failedLinks.includes(c.id))
    .filter((c) => c.config.type !== 'vpn' || !!c.config.cgwId)
    .sort((a, b) => (a.type === 'dx' ? 0 : 1) - (b.type === 'dx' ? 0 : 1));
}

function linkHop(_board: Board, link: Component, toward: string): Hop {
  if (link.config.type === 'dx') {
    const enc = link.config.encryption === 'none' ? 'not encrypted (Direct Connect does not encrypt by default)' : link.config.encryption === 'macsec' ? 'encrypted with MACsec at layer 2' : 'encrypted by an IPsec VPN running over the connection';
    return { at: { kind: 'component', id: link.id }, check: 'dx', result: 'allow', explain: `${link.name}: a private ${link.config.speedGbps} Gbps Direct Connect link carries the packet ${toward}. Consistent bandwidth and latency, ${enc}.` };
  }
  return { at: { kind: 'component', id: link.id }, check: 'vpn', result: 'allow', explain: `${link.name}: an IPsec Site-to-Site VPN tunnel carries the packet ${toward} over the internet. Encrypted, up to ~1.25 Gbps per tunnel, and latency varies with the internet path.` };
}

function attachmentLabel(board: Board, a: string): string {
  return board.components[a]?.name ?? vpcLabel(board, a);
}

export interface TgwLookup {
  rt?: TgwRouteTable;
  route?: { dest: string; attachment: string; propagated: boolean };
}

/** CIDR an attachment propagates into TGW route tables. */
function attachmentCidr(board: Board, tgw: Component, a: string): string | null {
  const cfg = tgw.config as ConfigOf<'tgw'>;
  if (cfg.vpcAttachments.includes(a)) return vpcById(board, a)?.cidr ?? null;
  const c = board.components[a];
  if (c && (c.config.type === 'vpn' || c.config.type === 'dx') && c.config.attachTo === tgw.id) return board.onprem?.cidr ?? null;
  return null;
}

/** All attachments of a TGW: VPCs plus the VPN / DX connections attached to it. */
export function tgwAttachments(board: Board, tgw: Component): string[] {
  const cfg = tgw.config as ConfigOf<'tgw'>;
  const links = Object.values(board.components).filter((c) => (c.config.type === 'vpn' || c.config.type === 'dx') && c.config.attachTo === tgw.id).map((c) => c.id);
  return [...cfg.vpcAttachments, ...links];
}

/** Longest-prefix lookup in the TGW route table associated with an attachment. Down links withdraw their propagated routes. */
export function tgwLookup(board: Board, tgw: Component, fromAttachment: string, ip: string, failedLinks: string[] = []): TgwLookup {
  const cfg = tgw.config as ConfigOf<'tgw'>;
  const rt = cfg.routeTables.find((r) => r.associations.includes(fromAttachment));
  if (!rt) return {};
  const cands: { dest: string; attachment: string; propagated: boolean; pref: number }[] = [];
  for (const r of rt.routes) if (isValidCidr(r.dest) && cidrContainsIp(r.dest, ip)) cands.push({ ...r, propagated: false, pref: 0 });
  for (const a of rt.propagations) {
    if (failedLinks.includes(a)) continue;
    const cidr = attachmentCidr(board, tgw, a);
    if (cidr && cidrContainsIp(cidr, ip)) cands.push({ dest: cidr, attachment: a, propagated: true, pref: board.components[a]?.type === 'vpn' ? 2 : 1 });
  }
  cands.sort((x, y) => parseCidr(y.dest).prefix - parseCidr(x.dest).prefix || x.pref - y.pref);
  const best = cands[0];
  return { rt, route: best && { dest: best.dest, attachment: best.attachment, propagated: best.propagated } };
}

function tgwHop(board: Board, tgw: Component, from: string, ip: string, l: TgwLookup, direction = ''): Hop {
  if (!l.rt)
    return { at: { kind: 'component', id: tgw.id }, check: 'tgw', result: 'deny', matched: { objectId: tgw.id, ruleRef: 'route tables' }, explain: `${direction}${attachmentLabel(board, from)} is attached to ${tgw.name} but not associated with any TGW route table, so the transit gateway has nowhere to look up ${ip} and drops it.` };
  if (!l.route)
    return { at: { kind: 'component', id: tgw.id }, check: 'tgw', result: 'deny', matched: { objectId: tgw.id, ruleRef: `route table ${l.rt.name}` }, explain: `${direction}${tgw.name} route table "${l.rt.name}" (associated with ${attachmentLabel(board, from)}) has no route to ${ip}. Propagate the destination attachment into this table or add a static route.` };
  if (l.route.attachment === 'blackhole')
    return { at: { kind: 'component', id: tgw.id }, check: 'tgw', result: 'deny', matched: { objectId: tgw.id, ruleRef: `route table ${l.rt.name}` }, explain: `${direction}${tgw.name} route table "${l.rt.name}" has a blackhole route for ${l.route.dest}: matching traffic is dropped on purpose.` };
  return {
    at: { kind: 'component', id: tgw.id },
    check: 'tgw',
    result: 'allow',
    matched: { objectId: tgw.id, ruleRef: `route table ${l.rt.name}` },
    explain: `${direction}${tgw.name} route table "${l.rt.name}" (associated with ${attachmentLabel(board, from)}): longest match for ${ip} is ${l.route.dest} → ${attachmentLabel(board, l.route.attachment)} (${l.route.propagated ? 'propagated' : 'static'}).`,
  };
}

/** Can a subnet's route table send traffic for `ip` back into `toVpcId`? */
function returnPath(board: Board, fromSubnetId: string, ip: string, toVpcId: string, opts: TraceOptions): Hop {
  const f = findSubnet(board, fromSubnetId)!;
  const rt = board.routeTables[f.subnet.routeTableId];
  const m = rt ? resolveRoute(board, rt.id, ip) : null;
  const deny = (why: string): Hop => ({ at: { kind: 'routeTable', id: f.subnet.routeTableId }, check: 'route', result: 'deny', matched: { objectId: f.subnet.routeTableId, ruleRef: m ? `route ${m.route.dest}` : 'routes' }, explain: `No way back: ${rt?.name ?? f.subnet.routeTableId} (${f.subnet.name}) ${why} Routing must be configured on both sides.` });
  if (!m || m.route.target === 'local') return deny(`has no route to ${ip}.`);
  const k = targetKind(m.route.target);
  const t = board.components[targetId(m.route.target)!];
  if (!t) return deny(`sends ${ip} to a deleted target (blackhole).`);
  const ok = (explain: string): Hop => ({ at: { kind: 'routeTable', id: rt!.id }, check: 'route', result: 'allow', matched: { objectId: rt!.id, ruleRef: `route ${m.route.dest}` }, explain });
  if (k === 'pcx') {
    if (pcxConnects(board, t, f.vpc.id, toVpcId)) return ok(`${rt!.name} routes the response to ${ip} back over ${t.name}.`);
    return deny(`sends ${ip} to ${t.name}, which doesn't lead to ${vpcLabel(board, toVpcId)}.`);
  }
  if (k === 'tgw') {
    const l = tgwLookup(board, t, f.vpc.id, ip, opts.failedLinks);
    if (l.route && l.route.attachment === toVpcId) return ok(`${rt!.name} routes the response to ${ip} to ${t.name}, and its route table "${l.rt!.name}" sends it on to ${vpcLabel(board, toVpcId)}.`);
    return { ...tgwHop(board, t, f.vpc.id, ip, l, 'Return path: '), result: 'deny' };
  }
  return deny(`sends ${ip} to ${t.name} (${k}), not back toward ${vpcLabel(board, toVpcId)}.`);
}

/** Can the response from an ENI reach the on-premises network? */
function returnToOnprem(board: Board, fromSubnetId: string, opts: TraceOptions): Hop {
  const ip = onpremIp(board);
  const f = findSubnet(board, fromSubnetId)!;
  const rt = board.routeTables[f.subnet.routeTableId];
  const m = rt ? resolveRoute(board, rt.id, ip) : null;
  const deny = (why: string): Hop => ({ at: { kind: 'routeTable', id: f.subnet.routeTableId }, check: 'route', result: 'deny', matched: { objectId: f.subnet.routeTableId, ruleRef: m ? `route ${m.route.dest}` : 'routes' }, explain: `No way back to on-premises: ${rt?.name ?? f.subnet.routeTableId} (${f.subnet.name}) ${why} Add ${board.onprem?.cidr ?? 'the on-premises CIDR'} → the virtual private gateway or transit gateway.` });
  if (!m || m.route.target === 'local') return deny(`has no route to ${ip}.`);
  const k = targetKind(m.route.target);
  const t = board.components[targetId(m.route.target)!];
  if (!t) return deny(`sends ${ip} to a deleted target (blackhole).`);
  if (k === 'vgw' && linksOn(board, t.id, opts.failedLinks).length) return { at: { kind: 'routeTable', id: rt!.id }, check: 'route', result: 'allow', matched: { objectId: rt!.id, ruleRef: `route ${m.route.dest}` }, explain: `${rt!.name} routes the response to on-premises through ${t.name}.` };
  if (k === 'tgw') {
    const l = tgwLookup(board, t, f.vpc.id, ip, opts.failedLinks);
    const link = l.route && board.components[l.route.attachment];
    if (link && (link.type === 'vpn' || link.type === 'dx')) return { at: { kind: 'routeTable', id: rt!.id }, check: 'route', result: 'allow', matched: { objectId: rt!.id, ruleRef: `route ${m.route.dest}` }, explain: `${rt!.name} routes the response to ${t.name}, whose route table "${l.rt!.name}" sends it over ${link.name}.` };
    return { ...tgwHop(board, t, f.vpc.id, ip, l, 'Return path: '), result: 'deny' };
  }
  return deny(`sends ${ip} to ${t.name} (${k}), which doesn't lead to the data centre.`);
}

interface Peer {
  ip: string;
  label: string;
  sgIds: string[];
  /** Source subnet whose NACL sees the response (absent for on-premises sources). */
  subnetId?: string;
}

/** Arriving in another VPC: destination NACL and SG, then the return route and stateless return checks. */
function arrive(board: Board, from: Peer, d: Eni, p: Protocol, port: number, hops: Hop[], back: Hop, via: PathVia, linkId?: string): LegResult {
  const returnHops: Hop[] = [];
  const dLabel = `${d.comp.name} (${d.ip})`;
  const n = naclCheck(board, d.subnetId, 'inbound', p, port, from.ip, from.label);
  hops.push(n);
  if (n.result === 'deny') return { ok: false, hops, returnHops, via, linkId };
  const sgIn = sgCheck(board, d, 'inbound', p, port, { ip: from.ip, sgIds: from.sgIds, label: from.label });
  hops.push(sgIn);
  if (sgIn.result === 'deny') return { ok: false, hops, returnHops, via, linkId };
  returnHops.push({ at: { kind: 'sg', id: d.sgIds[0] ?? d.comp.id }, check: 'sg-out', result: 'info', explain: `Security groups are stateful: ${d.comp.name}'s response is allowed out automatically.` });
  const r1 = naclCheck(board, d.subnetId, 'outbound', p, RETURN_PORT, from.ip, from.label, true);
  returnHops.push(r1);
  if (r1.result === 'deny') return { ok: false, hops, returnHops, via, linkId };
  returnHops.push(back);
  if (back.result === 'deny') return { ok: false, hops, returnHops, via, linkId };
  if (from.subnetId) {
    const r2 = naclCheck(board, from.subnetId, 'inbound', p, RETURN_PORT, d.ip, dLabel, true);
    returnHops.push(r2);
    if (r2.result === 'deny') return { ok: false, hops, returnHops, via, linkId };
  }
  return { ok: true, hops, returnHops, via, linkId };
}

function crossVpc(board: Board, src: Eni, dst: Eni | External, kind: 'pcx' | 'tgw' | 'vgw', target: Component, hops: Hop[], p: Protocol, port: number, opts: TraceOptions): LegResult {
  const srcVpc = findSubnet(board, src.subnetId)!.vpc;
  const failedRegions = opts.failedRegions ?? [];
  const dstLabel = 'kind' in dst ? dst.label : `${dst.comp.name} (${dst.ip})`;
  const from: Peer = { ip: src.ip, label: `${src.comp.name} (${src.ip}) [${sgNames(board, src.sgIds)}]`, sgIds: src.sgIds, subnetId: src.subnetId };
  const deny = (h: Omit<Hop, 'result'>, via: PathVia): LegResult => {
    hops.push({ ...h, result: 'deny' });
    return { ok: false, hops, returnHops: [], via };
  };

  if (kind === 'pcx') {
    const cfg = target.config as ConfigOf<'pcx'>;
    const other = target.placement.refId === srcVpc.id ? cfg.peerVpcId : cfg.peerVpcId === srcVpc.id ? target.placement.refId : null;
    if (!other) return deny({ at: { kind: 'component', id: target.id }, check: 'peering', explain: `${target.name} does not connect ${vpcLabel(board, srcVpc.id)} to anything.` }, 'pcx');
    if (failedRegions.includes(regionOfVpc(board, other) ?? '')) return deny({ at: { kind: 'component', id: target.id }, check: 'region', explain: `The peer VPC's Region (${regionOfVpc(board, other)}) is down.` }, 'pcx');
    if ('kind' in dst)
      return deny({ at: { kind: 'component', id: target.id }, check: 'peering', matched: { objectId: target.id, ruleRef: 'edge-to-edge' }, explain: `Edge-to-edge routing is not supported: ${target.name} only delivers to addresses inside ${vpcLabel(board, other)}. The peer VPC's internet gateway, NAT gateway, VPN or Direct Connect can't be used on your behalf, so ${dstLabel} is unreachable this way.` }, 'pcx');
    const dVpc = findSubnet(board, dst.subnetId)!.vpc;
    if (dVpc.id !== other)
      return deny({ at: { kind: 'component', id: target.id }, check: 'peering', matched: { objectId: target.id, ruleRef: 'not transitive' }, explain: `Peering is not transitive: ${target.name} joins ${vpcLabel(board, srcVpc.id)} and ${vpcLabel(board, other)}, but ${dst.comp.name} lives in ${vpcLabel(board, dVpc.id)}. Traffic can't hop through a peered VPC to reach a third one. Peer the two VPCs directly, or use a transit gateway.` }, 'pcx');
    const inter = regionOfVpc(board, other) !== regionOfVpc(board, srcVpc.id);
    hops.push({ at: { kind: 'component', id: target.id }, check: 'peering', result: 'allow', explain: `${target.name} carries the packet from ${vpcLabel(board, srcVpc.id)} into ${vpcLabel(board, other)}${inter ? ' across Regions on the AWS backbone (encrypted, inter-Region data transfer charges apply)' : ''}. No gateway, no bandwidth bottleneck, no single point of failure.` });
    return arrive(board, from, dst, p, port, hops, returnPath(board, dst.subnetId, src.ip, srcVpc.id, opts), 'pcx');
  }

  if (kind === 'tgw') {
    const cfg = target.config as ConfigOf<'tgw'>;
    if (failedRegions.includes(regionOf(board, target))) return deny({ at: { kind: 'component', id: target.id }, check: 'region', explain: `${target.name}'s Region is down.` }, 'tgw');
    if (!cfg.vpcAttachments.includes(srcVpc.id)) return deny({ at: { kind: 'component', id: target.id }, check: 'tgw', matched: { objectId: target.id, ruleRef: 'attachments' }, explain: `${vpcLabel(board, srcVpc.id)} has no attachment on ${target.name}.` }, 'tgw');
    const ip = 'kind' in dst ? dst.ip : dst.ip;
    const l = tgwLookup(board, target, srcVpc.id, ip, opts.failedLinks);
    const h = tgwHop(board, target, srcVpc.id, ip, l);
    hops.push(h);
    if (h.result === 'deny') return { ok: false, hops, returnHops: [], via: 'tgw' };
    const a = l.route!.attachment;
    const link = board.components[a];
    if (link && (link.type === 'vpn' || link.type === 'dx')) {
      if (!('kind' in dst) || !dst.onprem) return deny({ at: { kind: 'component', id: target.id }, check: 'tgw', explain: `That route leads to the data centre over ${link.name}, but ${dstLabel} isn't there.` }, 'tgw');
      hops.push(linkHop(board, link, 'to the data centre'));
      const returnHops: Hop[] = [{ at: { kind: 'onprem', id: 'onprem' }, check: 'route', result: 'info', explain: `The on-premises router learned ${srcVpc.cidr} over BGP and sends the response back over ${link.name}.` }];
      const back = tgwLookup(board, target, link.id, src.ip, opts.failedLinks);
      const bh = tgwHop(board, target, link.id, src.ip, back, 'Return path: ');
      if (bh.result === 'allow' && back.route!.attachment !== srcVpc.id) bh.result = 'deny';
      returnHops.push(bh);
      if (bh.result === 'deny') return { ok: false, hops, returnHops, via: link.type as PathVia, linkId: link.id };
      const r = naclCheck(board, src.subnetId, 'inbound', p, RETURN_PORT, dst.ip, dst.label, true);
      returnHops.push(r);
      return { ok: r.result !== 'deny', hops, returnHops, via: link.type as PathVia, linkId: link.id };
    }
    if ('kind' in dst) return deny({ at: { kind: 'component', id: target.id }, check: 'tgw', explain: `That route leads into ${vpcLabel(board, a)}, but ${dstLabel} isn't there. Centralised egress through another VPC is not modelled.` }, 'tgw');
    const dVpc = findSubnet(board, dst.subnetId)!.vpc;
    if (a !== dVpc.id) return deny({ at: { kind: 'component', id: target.id }, check: 'tgw', explain: `The TGW sends ${ip} to ${attachmentLabel(board, a)}, but ${dst.comp.name} lives in ${vpcLabel(board, dVpc.id)}.` }, 'tgw');
    return arrive(board, from, dst, p, port, hops, returnPath(board, dst.subnetId, src.ip, srcVpc.id, opts), 'tgw');
  }

  // Virtual private gateway: the only way on is a VPN or Direct Connect connection to the data centre.
  if (target.placement.refId !== srcVpc.id) return deny({ at: { kind: 'component', id: target.id }, check: 'route', explain: `${target.name} is attached to another VPC.` }, 'vpn');
  if (!('kind' in dst) || !dst.onprem) return deny({ at: { kind: 'component', id: target.id }, check: 'vpn', explain: `${target.name} only leads to networks connected by VPN or Direct Connect. ${dstLabel} isn't one of them.` }, 'vpn');
  const all = Object.values(board.components).filter((c) => (c.config.type === 'vpn' || c.config.type === 'dx') && c.config.attachTo === target.id);
  const up = linksOn(board, target.id, opts.failedLinks);
  if (!up.length) {
    const why = all.length ? `${all.map((c) => c.name).join(' and ')} ${all.length > 1 ? 'are' : 'is'} down, and there is no other connection to fail over to.` : 'No VPN or Direct Connect connection is attached to it.';
    return deny({ at: { kind: 'component', id: target.id }, check: all.length ? (all[0].type as 'vpn' | 'dx') : 'vpn', explain: `${target.name}: ${why}` }, 'vpn');
  }
  const link = up[0];
  hops.push(linkHop(board, link, 'to the data centre'));
  const failedOver = all.length > up.length ? ` ${all.filter((c) => !up.includes(c)).map((c) => c.name).join(', ')} is down; BGP withdrew its routes and traffic failed over.` : '';
  if (failedOver) hops[hops.length - 1].explain += failedOver;
  const returnHops: Hop[] = [{ at: { kind: 'onprem', id: 'onprem' }, check: 'route', result: 'info', explain: `The on-premises router learned ${srcVpc.cidr} over BGP and sends the response back over ${link.name}.` }];
  const r = naclCheck(board, src.subnetId, 'inbound', p, RETURN_PORT, dst.ip, dst.label, true);
  returnHops.push(r);
  return { ok: r.result !== 'deny', hops, returnHops, via: link.type as PathVia, linkId: link.id };
}

/** From a host in the data centre to an ENI in a VPC, over whichever connection BGP prefers. */
function traceFromOnprem(board: Board, dstComp: Component, p: Protocol, port: number, opts: TraceOptions): Trace {
  const failed = opts.failedAzs ?? [];
  if (!board.onprem) return dropped([{ at: { kind: 'onprem', id: 'onprem' }, check: 'exists', result: 'deny', explain: 'There is no on-premises data centre on this board.' }]);
  const ip = onpremIp(board);
  const from: Peer = { ip, label: `on-premises host ${ip}`, sgIds: [] };
  const enis = enisOf(board, dstComp, failed, opts.failedRegions);
  if (dstComp.placement.kind !== 'subnet') return dropped([{ at: { kind: 'component', id: dstComp.id }, check: 'exists', result: 'deny', explain: `${dstComp.name} is a regional service with a public endpoint; private connectivity to it needs an interface endpoint, which is not modelled.` }]);
  if (!enis.length) return dropped([{ at: { kind: 'component', id: dstComp.id }, check: 'az', result: 'deny', explain: `${dstComp.name} has no running interface.` }]);
  const all = Object.values(board.components).filter((c) => (c.config.type === 'vpn' || c.config.type === 'dx') && c.config.attachTo);
  const links = all.filter((c) => !(opts.failedLinks ?? []).includes(c.id) && (c.config.type !== 'vpn' || c.config.cgwId)).sort((a, b) => (a.type === 'dx' ? 0 : 1) - (b.type === 'dx' ? 0 : 1));
  if (!links.length) {
    const why = all.length ? `${all.map((c) => c.name).join(' and ')} ${all.length > 1 ? 'are' : 'is'} down and nothing else connects the data centre to AWS.` : 'Nothing connects the data centre to AWS: add a customer gateway and a Site-to-Site VPN, or a Direct Connect connection.';
    return dropped([{ at: { kind: 'onprem', id: 'onprem' }, check: all.length ? (all[0].type as 'vpn' | 'dx') : 'vpn', result: 'deny', explain: why }]);
  }
  let firstFail: Trace | null = null;
  for (const link of links) {
    const gw = board.components[(link.config as ConfigOf<'vpn'> | ConfigOf<'dx'>).attachTo!];
    if (!gw) continue;
    for (const d of enis) {
      const hops: Hop[] = [{ at: { kind: 'onprem', id: 'onprem' }, check: 'route', result: 'info', explain: `The on-premises router has a route to ${d.ip} over ${link.name}${links.length > 1 && link === links[0] && link.type === 'dx' ? ' (BGP prefers Direct Connect over VPN for the same prefix)' : ''}.` }, linkHop(board, link, 'into AWS')];
      const dVpc = findSubnet(board, d.subnetId)!.vpc;
      let back: Hop;
      let via: PathVia = link.type as PathVia;
      if (gw.type === 'vgw') {
        if (gw.placement.refId !== dVpc.id) {
          hops.push({ at: { kind: 'component', id: gw.id }, check: 'route', result: 'deny', explain: `${link.name} lands on ${gw.name}, which is attached to ${vpcLabel(board, gw.placement.refId)}. ${dstComp.name} is in ${vpcLabel(board, dVpc.id)}: a VPC never forwards VPN or DX traffic on to another VPC (no transitive routing). Use a transit gateway.` });
          firstFail ??= dropped(hops, [], via);
          continue;
        }
        hops.push({ at: { kind: 'component', id: gw.id }, check: 'route', result: 'allow', explain: `${gw.name} delivers the packet into ${vpcLabel(board, dVpc.id)}.` });
        back = returnToOnprem(board, d.subnetId, opts);
      } else {
        if ((opts.failedRegions ?? []).includes(regionOf(board, gw))) continue;
        const l = tgwLookup(board, gw, link.id, d.ip, opts.failedLinks);
        const h = tgwHop(board, gw, link.id, d.ip, l);
        if (h.result === 'allow' && l.route!.attachment !== dVpc.id) {
          h.result = 'deny';
          h.explain += ` ${dstComp.name} is not in that VPC.`;
        }
        hops.push(h);
        if (h.result === 'deny') {
          firstFail ??= dropped(hops, [], via);
          continue;
        }
        back = returnToOnprem(board, d.subnetId, opts);
      }
      const r = arrive(board, from, d, p, port, hops, back, via, link.id);
      const t: Trace = { result: r.ok ? 'delivered' : 'dropped', hops: r.hops, returnHops: r.returnHops, via, linkId: link.id };
      if (r.ok) return t;
      firstFail ??= t;
    }
  }
  return firstFail ?? dropped([{ at: { kind: 'onprem', id: 'onprem' }, check: 'route', result: 'deny', explain: `No connection leads to ${dstComp.name}'s VPC.` }]);
}

/** Internet client to an ENI (EC2, RDS, internet-facing ALB node). */
function inboundFromInternet(board: Board, dst: Eni, p: Protocol, port: number): LegResult {
  const hops: Hop[] = [];
  const returnHops: Hop[] = [];
  const f = findSubnet(board, dst.subnetId)!;
  const igw = Object.values(board.components).find((c) => c.type === 'igw' && c.placement.refId === f.vpc.id);
  if (!igw) {
    hops.push({ at: { kind: 'internet', id: 'internet' }, check: 'igw', result: 'deny', explain: `The VPC has no internet gateway, so nothing on the internet can reach it.` });
    return { ok: false, hops, returnHops, via: 'igw' };
  }
  hops.push({ at: { kind: 'igw', id: igw.id }, check: 'igw', result: 'info', explain: `Traffic from the internet enters through ${igw.name}.` });
  const rt = board.routeTables[f.subnet.routeTableId];
  const back = rt ? resolveRoute(board, rt.id, INTERNET_IP) : null;
  const toIgw = back && targetKind(back.route.target) === 'igw' && board.components[targetId(back.route.target)!];
  if (!toIgw) {
    hops.push({
      at: { kind: 'routeTable', id: f.subnet.routeTableId },
      check: 'route',
      result: 'deny',
      matched: { objectId: f.subnet.routeTableId, ruleRef: 'route 0.0.0.0/0' },
      explain: `${f.subnet.name} is private: ${rt?.name} has no 0.0.0.0/0 → internet gateway route, so ${dst.comp.name} cannot be reached from (or answer) the internet.`,
    });
    return { ok: false, hops, returnHops, via: 'igw' };
  }
  hops.push({ at: { kind: 'routeTable', id: rt!.id }, check: 'route', result: 'allow', matched: { objectId: rt!.id, ruleRef: `route ${back!.route.dest}` }, explain: `${f.subnet.name} is public: ${rt!.name} routes 0.0.0.0/0 to ${(toIgw as Component).name}.` });
  if (!dst.publicIp) {
    const what = dst.comp.type === 'rds' ? 'is not publicly accessible' : dst.comp.type === 'alb' ? 'is an internal load balancer' : 'has no public IPv4 address';
    hops.push({ at: { kind: 'component', id: dst.comp.id }, check: 'public-ip', result: 'deny', explain: `${dst.comp.name} ${what}, so the internet gateway has nothing to translate the traffic to.` });
    return { ok: false, hops, returnHops, via: 'igw' };
  }
  hops.push({ at: { kind: 'component', id: dst.comp.id }, check: 'public-ip', result: 'allow', explain: `${dst.comp.name} has a public address in ${f.subnet.name}.` });
  const n = naclCheck(board, dst.subnetId, 'inbound', p, port, INTERNET_IP, 'the internet (0.0.0.0/0)');
  hops.push(n);
  if (n.result === 'deny') return { ok: false, hops, returnHops, via: 'igw' };
  const s = sgCheck(board, dst, 'inbound', p, port, { ip: INTERNET_IP, sgIds: [], label: 'the internet' });
  hops.push(s);
  if (s.result === 'deny') return { ok: false, hops, returnHops, via: 'igw' };
  returnHops.push({ at: { kind: 'sg', id: dst.sgIds[0] ?? dst.comp.id }, check: 'sg-out', result: 'info', explain: 'Security groups are stateful: the response is allowed out automatically.' });
  const r = naclCheck(board, dst.subnetId, 'outbound', p, RETURN_PORT, INTERNET_IP, 'the client', true);
  returnHops.push(r);
  return { ok: r.result !== 'deny', hops, returnHops, via: 'igw' };
}

// ---------- Load balancer second leg ----------

function albToTargets(board: Board, alb: Component, nodes: Eni[], p: Protocol, opts: TraceOptions): LegResult {
  const cfg = alb.config as ConfigOf<'alb'>;
  const hops: Hop[] = [];
  const target = cfg.targetId ? board.components[cfg.targetId] : undefined;
  if (!target) {
    hops.push({ at: { kind: 'component', id: alb.id }, check: 'lb-target-health', result: 'deny', explain: `${alb.name}'s target group is empty. The listener answers with HTTP 503.` });
    return { ok: false, hops, returnHops: [], via: 'local' };
  }
  const targets = enisOf(board, target, opts.failedAzs, opts.failedRegions);
  const app = (target.config as ConfigOf<'asg'> | ConfigOf<'ec2'>).app;
  if (!targets.length) {
    hops.push({ at: { kind: 'component', id: target.id }, check: 'lb-target-health', result: 'deny', explain: `${target.name} has no running instances in a working AZ. The target group has 0 healthy targets, so the ALB returns HTTP 503.` });
    return { ok: false, hops, returnHops: [], via: 'local' };
  }
  // Health checks ask for a path the app doesn't serve: every target is unhealthy. An ALB then
  // fails open and routes requests to all registered targets anyway.
  const pathMismatch = !!app && app.healthPath !== cfg.healthCheck.path;
  // A new connection from an ALB node to a target. With cross-zone on, any node can reach any target.
  let firstFail: LegResult | null = null;
  for (const node of nodes) {
    const candidates = cfg.crossZone ? [...targets].sort((a, b) => (a.azId === node.azId ? -1 : 0) - (b.azId === node.azId ? -1 : 0)) : targets.filter((t) => t.azId === node.azId);
    for (const t of candidates) {
      const l = leg(board, node, t, p, cfg.targetPort, opts);
      if (l.ok) {
        const healthy = pathMismatch ? 0 : targets.filter((x) => leg(board, node, x, p, cfg.targetPort, opts).ok).length;
        const health: Hop = pathMismatch
          ? {
              at: { kind: 'component', id: alb.id },
              check: 'lb-target-health',
              result: 'info',
              matched: { objectId: alb.id, ruleRef: 'health check path' },
              explain: `0/${targets.length} healthy: health checks request ${cfg.healthCheck.path}, but ${target.name} serves ${app!.healthPath}. With no healthy target the ALB fails open and routes to every registered target, so this request still gets through.`,
            }
          : { at: { kind: 'component', id: alb.id }, check: 'lb-target-health', result: 'allow', explain: `New connection from the ALB node in ${node.azId} (${node.ip}) to ${target.name} on port ${cfg.targetPort}. ${healthy}/${targets.length} targets reachable and passing ${cfg.healthCheck.path}.` };
        return {
          ok: true,
          hops: [
            health,
            ...l.hops,
          ],
          returnHops: l.returnHops,
          via: 'local',
        };
      }
      firstFail ??= l;
    }
  }
  const f = firstFail ?? { ok: false, hops: [], returnHops: [], via: 'local' as PathVia };
  return {
    ok: false,
    hops: [{ at: { kind: 'component', id: alb.id }, check: 'lb-target-health', result: f.hops.length ? 'info' : 'deny', explain: f.returnHops.some((h) => h.result === 'deny')
          ? `Requests reach ${target.name} on port ${cfg.targetPort}, but the responses never make it back. Health checks time out too (0/${targets.length} healthy), the ALB fails open, and clients wait until they get HTTP 504 Gateway Timeout.`
          : `The ALB can't open a connection to any ${target.name} instance on port ${cfg.targetPort}, so health checks fail (0/${targets.length} healthy) and clients get HTTP 502/504.` }, ...f.hops],
    returnHops: f.returnHops,
    via: 'local',
  };
}

// ---------- Latency ----------

/** Approximate round-trip time from a city to us-east-1 and to the nearest CloudFront edge (see geo.ts for every Region). */
export const CITY_RTT: Record<string, { region: number; edge: number; label: string }> = Object.fromEntries(
  Object.entries(CITIES).map(([k, c]) => [k, { region: c.rtt['us-east-1'], edge: c.edge, label: c.label }]),
);

// ---------- Public entry ----------

function serviceEndpoint(board: Board, to: Endpoint): External | null {
  if (to === 'internet') return { kind: 'external', ip: INTERNET_IP, label: `an internet host (${INTERNET_IP})` };
  if (to === 'svc:s3') return { kind: 'external', ip: SERVICE_IPS.s3, label: 'Amazon S3', service: 's3' };
  if (to === 'svc:dynamodb') return { kind: 'external', ip: SERVICE_IPS.dynamodb, label: 'Amazon DynamoDB', service: 'dynamodb' };
  if (to === 'onprem') return board.onprem ? { kind: 'external', ip: onpremIp(board), label: `the on-premises host ${onpremIp(board)}`, onprem: true } : null;
  const c = board.components[to];
  if (c?.type === 's3') return { kind: 'external', ip: SERVICE_IPS.s3, label: `S3 bucket ${c.name}`, service: 's3' };
  if (c?.type === 'dynamodb') return { kind: 'external', ip: SERVICE_IPS.dynamodb, label: `DynamoDB table ${c.name}`, service: 'dynamodb' };
  if (c && ['sqs', 'apigw', 'lambda'].includes(c.type)) return { kind: 'external', ip: INTERNET_IP, label: `the public ${c.type.toUpperCase()} endpoint for ${c.name}` };
  return null;
}

function dropped(hops: Hop[], returnHops: Hop[] = [], via: PathVia = 'none'): Trace {
  return { result: 'dropped', hops, returnHops, via };
}

export function traceFlow(board: Board, flow: Flow, opts: TraceOptions = {}): Trace {
  const failed = opts.failedAzs ?? [];
  const failedRegions = opts.failedRegions ?? [];
  const p = flow.protocol;
  const city = flow.clientCity ?? 'virginia';

  // ----- From the internet -----
  if (flow.from === 'internet') {
    const dst = board.components[flow.to];
    if (!dst) return dropped([{ at: { kind: 'internet', id: 'internet' }, check: 'exists', result: 'deny', explain: `There is nothing on the board to send traffic to.` }]);
    return traceFromInternet(board, dst, p, flow.port, city, opts, []);
  }

  // ----- From the data centre -----
  if (flow.from === 'onprem') {
    const dst = board.components[flow.to];
    if (!dst) return dropped([{ at: { kind: 'onprem', id: 'onprem' }, check: 'exists', result: 'deny', explain: `The destination isn't on the board.` }]);
    return traceFromOnprem(board, dst, p, flow.port, opts);
  }

  const src = board.components[flow.from];
  if (!src) return dropped([{ at: { kind: 'internet', id: 'internet' }, check: 'exists', result: 'deny', explain: `The source isn't on the board.` }]);
  if (failedRegions.includes(regionOf(board, src))) return dropped([{ at: { kind: 'component', id: src.id }, check: 'region', result: 'deny', explain: `${src.name} is in ${regionName(regionOf(board, src))}, which is down.` }]);

  // Regional serverless services (non-VPC Lambda, API Gateway) run in AWS-managed networks.
  if (src.placement.kind !== 'subnet') {
    return {
      result: 'delivered',
      hops: [{ at: { kind: 'component', id: src.id }, check: 'route', result: 'info', explain: `${src.name} runs outside your VPC in an AWS-managed network with access to public AWS endpoints. Network-level checks don't apply; whether the call is allowed is an IAM question (switch the tracer to API call).` }],
      returnHops: [],
      via: 'none',
    };
  }

  const srcEnis = enisOf(board, src, failed, failedRegions);
  if (!srcEnis.length) {
    return dropped([{ at: { kind: 'component', id: src.id }, check: 'az', result: 'deny', explain: `${src.name} has no running interface in a working Availability Zone.` }]);
  }

  const external = serviceEndpoint(board, flow.to);
  const dstComp = board.components[flow.to];
  if (!external && !dstComp) return dropped([{ at: { kind: 'component', id: src.id }, check: 'exists', result: 'deny', explain: `The destination isn't on the board.` }]);

  const paths: NonNullable<Trace['paths']> = [];
  let rep: Trace | null = null;
  for (const s of srcEnis) {
    let t: Trace;
    if (external) {
      const l = leg(board, s, external, p, flow.port, opts);
      t = { result: l.ok ? 'delivered' : 'dropped', hops: l.hops, returnHops: l.returnHops, via: l.via, linkId: l.linkId };
    } else {
      const dEnis = enisOf(board, dstComp!, failed, failedRegions).sort((a, b) => (a.azId === s.azId ? -1 : 0) - (b.azId === s.azId ? -1 : 0));
      if (!dEnis.length) {
        const down = failedRegions.includes(regionOf(board, dstComp!));
        t = dropped([{ at: { kind: 'component', id: dstComp!.id }, check: down ? 'region' : 'az', result: 'deny', explain: down ? `${dstComp!.name}'s Region is down.` : `${dstComp!.name} has no running interface in a working Availability Zone.` }]);
      } else {
        t = dropped([]);
        for (const d of dEnis) {
          const l = leg(board, s, d, p, flow.port, opts);
          let cand: Trace = { result: l.ok ? 'delivered' : 'dropped', hops: l.hops, returnHops: l.returnHops, via: l.via };
          if (l.ok && dstComp!.type === 'alb') {
            const second = albToTargets(board, dstComp!, [d], p, opts);
            cand = { result: second.ok ? 'delivered' : 'dropped', hops: [...l.hops, ...second.hops], returnHops: [...second.returnHops, ...l.returnHops], via: l.via === 'local' ? 'local' : l.via };
          }
          if (cand.result === 'delivered') {
            t = cand;
            break;
          }
          if (!t.hops.length) t = cand;
        }
      }
    }
    paths.push({ subnetId: s.subnetId, result: t.result, via: t.via });
    if (!rep || (rep.result === 'delivered' && t.result === 'dropped')) rep = t;
  }
  const all = paths.every((x) => x.result === 'delivered');
  return { ...rep!, result: all ? 'delivered' : 'dropped', paths };
}

function traceFromInternet(board: Board, dst: Component, p: Protocol, port: number, cityKey: string, opts: TraceOptions, prefix: Hop[]): Trace {
  const failed = opts.failedAzs ?? [];
  const failedRegions = opts.failedRegions ?? [];
  const hops = [...prefix];
  const cfg = dst.config;
  const cityInfo = CITIES[cityKey] ?? CITIES.virginia;
  const city = { region: cityRtt(cityKey, regionOf(board, dst)), edge: cityInfo.edge, label: cityInfo.label };

  if (cfg.type === 'route53') {
    if ((cfg.policy ?? 'simple') === 'simple') {
      const target = cfg.aliasTargetId ? board.components[cfg.aliasTargetId] : undefined;
      if (!target) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'dns', result: 'deny', explain: `${cfg.recordName}: the record has no alias target, so DNS returns NXDOMAIN.` }]);
      hops.push({ at: { kind: 'component', id: dst.id }, check: 'dns', result: 'allow', explain: `Route 53 answers ${cfg.recordName} with an alias to ${target.name}. Alias records to AWS resources are free to query and follow IP changes automatically.` });
      return traceFromInternet(board, target, p, port, cityKey, opts, hops);
    }
    const ans = resolveDns(board, cfg, cityKey, failedRegions);
    const target = ans.targetId ? board.components[ans.targetId] : undefined;
    if (!target) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'dns', result: 'deny', matched: { objectId: dst.id, ruleRef: 'records' }, explain: ans.explain }]);
    hops.push({ at: { kind: 'component', id: dst.id }, check: 'dns', result: 'allow', matched: { objectId: dst.id, ruleRef: 'records' }, explain: ans.explain });
    return traceFromInternet(board, target, p, port, cityKey, opts, hops);
  }

  const dstRegion = regionOf(board, dst);
  if (failedRegions.includes(dstRegion)) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'region', result: 'deny', explain: `${dst.name} is in ${regionName(dstRegion)}, which is down. Requests time out.` }]);

  if (cfg.type === 'cloudfront') {
    if (port === 80 && cfg.viewerProtocol === 'https-only') return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'edge', result: 'deny', explain: `${dst.name} only accepts HTTPS.` }]);
    hops.push({ at: { kind: 'component', id: dst.id }, check: 'edge', result: 'allow', explain: `The viewer in ${city.label} connects to the nearest CloudFront edge location (~${city.edge} ms RTT). TLS terminates at the edge.` });
    const origin = cfg.originId ? board.components[cfg.originId] : undefined;
    if (!origin) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'origin', result: 'deny', explain: `${dst.name} has no origin configured. Every cache miss returns HTTP 502.` }]);
    const origin0 = cfg.originId ? board.components[cfg.originId] : undefined;
    const missRtt = origin0 ? cityRtt(cityKey, regionOf(board, origin0)) : city.region; // edge -> origin over the AWS backbone, roughly the same distance
    const latency = Math.round(city.edge + (1 - cfg.cacheHitRatio) * missRtt);
    if (origin.config.type === 's3') {
      const o = origin.config;
      const publicRead = o.policy === 'public-read' && !o.blockPublicAccess;
      if (cfg.oac) {
        if (o.policy === 'cloudfront-oac' && o.policyDistributionId === dst.id) {
          hops.push({ at: { kind: 'component', id: origin.id }, check: 'origin', result: 'allow', explain: `On a cache miss ${dst.name} signs the origin request with Origin Access Control (SigV4). ${origin.name}'s bucket policy allows cloudfront.amazonaws.com with AWS:SourceArn = this distribution.` });
          return { result: 'delivered', hops, returnHops: [], via: 'edge', latencyMs: latency };
        }
        if (publicRead) {
          hops.push({ at: { kind: 'component', id: origin.id }, check: 'origin', result: 'allow', explain: `${origin.name} is public, so the origin request succeeds, but so does any direct request that bypasses CloudFront.` });
          return { result: 'delivered', hops, returnHops: [], via: 'edge', latencyMs: latency };
        }
        return dropped([...hops, { at: { kind: 'component', id: origin.id }, check: 'origin', result: 'deny', matched: { objectId: origin.id, ruleRef: 'bucket policy' }, explain: `403 AccessDenied from ${origin.name}: OAC signs the request, but the bucket policy doesn't grant s3:GetObject to cloudfront.amazonaws.com for this distribution.` }]);
      }
      if (publicRead) {
        hops.push({ at: { kind: 'component', id: origin.id }, check: 'origin', result: 'allow', explain: `No OAC: the origin request is anonymous, which only works because ${origin.name} is publicly readable.` });
        return { result: 'delivered', hops, returnHops: [], via: 'edge', latencyMs: latency };
      }
      return dropped([...hops, { at: { kind: 'component', id: origin.id }, check: 'origin', result: 'deny', matched: { objectId: dst.id, ruleRef: 'origin access' }, explain: `403 AccessDenied: ${dst.name} sends anonymous origin requests (no Origin Access Control) and ${origin.name} is private.` }]);
    }
    if (origin.type === 'alb') {
      hops.push({ at: { kind: 'component', id: dst.id }, check: 'origin', result: 'info', explain: `Cache misses go to ${origin.name} over the internet.` });
      const t = traceFromInternet(board, origin, p, 443, cityKey, opts, hops);
      return { ...t, latencyMs: latency };
    }
    return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'origin', result: 'deny', explain: `${origin.name} can't be a CloudFront origin here.` }]);
  }

  if (cfg.type === 's3') {
    const latency = city.region;
    if (cfg.blockPublicAccess) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'origin', result: 'deny', matched: { objectId: dst.id, ruleRef: 'Block Public Access' }, explain: `403 AccessDenied: Block Public Access is on for ${dst.name}, so anonymous requests are refused whatever the policy says.` }]);
    if (cfg.policy !== 'public-read') return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'origin', result: 'deny', matched: { objectId: dst.id, ruleRef: 'bucket policy' }, explain: `403 AccessDenied: no bucket policy grants anonymous s3:GetObject on ${dst.name}.` }]);
    hops.push({ at: { kind: 'component', id: dst.id }, check: 'origin', result: 'allow', explain: `${dst.name} is publicly readable. Every request travels to ${dstRegion} (~${latency} ms RTT from ${city.label}).` });
    return { result: 'delivered', hops, returnHops: [], via: 'igw', latencyMs: latency };
  }

  if (cfg.type === 'apigw' || cfg.type === 'sqs' || cfg.type === 'lambda' || cfg.type === 'dynamodb') {
    hops.push({ at: { kind: 'component', id: dst.id }, check: 'edge', result: 'info', explain: `${dst.name} is a public regional endpoint. Network reachability is not the control here; authentication and IAM are (switch the tracer to API call).` });
    return { result: 'delivered', hops, returnHops: [], via: 'none', latencyMs: city.region };
  }

  if (dst.placement.kind !== 'subnet') return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'exists', result: 'deny', explain: `${dst.name} does not accept connections from the internet.` }]);

  const enis = enisOf(board, dst, failed, failedRegions);
  if (!enis.length) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'az', result: 'deny', explain: `${dst.name} has no running interface in a working Availability Zone.` }]);

  if (cfg.type === 'alb') {
    if (cfg.scheme === 'internal') return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'public-ip', result: 'deny', explain: `${dst.name} is an internal load balancer: its DNS name resolves to private IPs only.` }]);
    if (port !== cfg.listener.port) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'lb-listener', result: 'deny', matched: { objectId: dst.id, ruleRef: 'listener' }, explain: `${dst.name} has no listener on port ${port} (it listens on ${cfg.listener.protocol} ${cfg.listener.port}). The connection is refused.` }]);
    let firstFail: Trace | null = null;
    const okNodes: Eni[] = [];
    let firstOk: LegResult | null = null;
    for (const node of enis) {
      const l = inboundFromInternet(board, node, p, port);
      if (l.ok) {
        okNodes.push(node);
        firstOk ??= l;
      } else firstFail ??= dropped([...hops, ...l.hops], l.returnHops, 'igw');
    }
    if (!firstOk) return firstFail!;
    const listener: Hop = { at: { kind: 'component', id: dst.id }, check: 'lb-listener', result: 'allow', matched: { objectId: dst.id, ruleRef: 'listener' }, explain: `${cfg.listener.protocol} :${cfg.listener.port} listener accepts the connection and forwards to the target group. This is the end of connection 1 (client → ALB).` };
    const second = albToTargets(board, dst, okNodes, p, opts);
    return {
      result: second.ok ? 'delivered' : 'dropped',
      hops: [...hops, ...firstOk.hops, listener, ...second.hops],
      returnHops: [...second.returnHops, ...firstOk.returnHops],
      via: 'igw',
      latencyMs: city.region,
    };
  }

  let firstFail: Trace | null = null;
  for (const e of enis) {
    const l = inboundFromInternet(board, e, p, port);
    if (l.ok) return { result: 'delivered', hops: [...hops, ...l.hops], returnHops: l.returnHops, via: 'igw', latencyMs: city.region };
    firstFail ??= dropped([...hops, ...l.hops], l.returnHops, 'igw');
  }
  return firstFail!;
}

/** The hop that dropped the trace, if any. */
export function failingHop(t: Trace): Hop | undefined {
  return [...t.hops, ...t.returnHops].find((h) => h.result === 'deny');
}
