// Packet tracer: follows a flow hop by hop using real VPC semantics.

import type { Board, Component, ConfigOf, Endpoint, Flow, Hop, PathVia, Protocol, SecurityGroup, Trace } from '../model';
import { eniIp, subnetsOf } from '../board';
import { evaluateNacl, RETURN_PORT } from './nacl';
import { describeSgRule, evaluateSgs } from './sg';
import { findSubnet, INTERNET_IP, resolveRoute, SERVICE_IPS, targetId, targetKind } from './routing';

export interface TraceOptions {
  failedAzs?: string[];
}

export interface Eni {
  comp: Component;
  subnetId: string;
  azId: string;
  ip: string;
  sgIds: string[];
  publicIp: boolean;
}

type External = { kind: 'external'; ip: string; label: string; service?: 's3' | 'dynamodb' };

interface LegResult {
  ok: boolean;
  hops: Hop[];
  returnHops: Hop[];
  via: PathVia;
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
  const cfg = c.config as ConfigOf<'rds'>;
  const subs = subnetsOf(c);
  const primary = subs[0];
  const az = findSubnet(board, primary)?.subnet.azId;
  if (!az || !failedAzs.includes(az)) return primary;
  if (!cfg.multiAz) return null;
  return subs.find((s) => !failedAzs.includes(findSubnet(board, s)?.subnet.azId ?? '')) ?? null;
}

export function enisOf(board: Board, c: Component, failedAzs: string[] = []): Eni[] {
  if (c.placement.kind !== 'subnet') return [];
  let subs = subnetsOf(c);
  if (c.type === 'rds') {
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
    if (cfg.type === 'rds') return cfg.publiclyAccessible;
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
    hops.push(routeHop('allow'));
  } else {
    const target = tId ? board.components[tId] : undefined;
    if (!target) {
      hops.push(routeHop('deny', ` The target no longer exists, so this is a blackhole route.`));
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

    hops.push({ at: { kind: 'routeTable', id: rt!.id }, check: 'route', result: 'deny', explain: `${kind} targets arrive in a later stage.` });
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
  const targets = enisOf(board, target, opts.failedAzs);
  const app = (target.config as ConfigOf<'asg'> | ConfigOf<'ec2'>).app;
  if (!targets.length) {
    hops.push({ at: { kind: 'component', id: target.id }, check: 'lb-target-health', result: 'deny', explain: `${target.name} has no running instances in a working AZ. The target group has 0 healthy targets, so the ALB returns HTTP 503.` });
    return { ok: false, hops, returnHops: [], via: 'local' };
  }
  if (app && app.healthPath !== cfg.healthCheck.path) {
    hops.push({
      at: { kind: 'component', id: alb.id },
      check: 'lb-target-health',
      result: 'deny',
      matched: { objectId: alb.id, ruleRef: 'health check path' },
      explain: `Health checks request ${cfg.healthCheck.path}, but ${target.name} serves ${app.healthPath}. Every target fails its health check (0/${targets.length} healthy), so the ALB returns HTTP 503.`,
    });
    return { ok: false, hops, returnHops: [], via: 'local' };
  }
  // A new connection from an ALB node to a target. With cross-zone on, any node can reach any target.
  let firstFail: LegResult | null = null;
  for (const node of nodes) {
    const candidates = cfg.crossZone ? [...targets].sort((a, b) => (a.azId === node.azId ? -1 : 0) - (b.azId === node.azId ? -1 : 0)) : targets.filter((t) => t.azId === node.azId);
    for (const t of candidates) {
      const l = leg(board, node, t, p, cfg.targetPort, opts);
      if (l.ok) {
        const healthy = targets.filter((x) => leg(board, node, x, p, cfg.targetPort, opts).ok).length;
        return {
          ok: true,
          hops: [
            { at: { kind: 'component', id: alb.id }, check: 'lb-target-health', result: 'allow', explain: `New connection from the ALB node in ${node.azId} (${node.ip}) to ${target.name} on port ${cfg.targetPort}. ${healthy}/${targets.length} targets reachable and passing ${cfg.healthCheck.path}.` },
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
    hops: [{ at: { kind: 'component', id: alb.id }, check: 'lb-target-health', result: f.hops.length ? 'info' : 'deny', explain: `The ALB can't open a connection to any ${target.name} instance on port ${cfg.targetPort}, so health checks fail and clients get HTTP 502/503.` }, ...f.hops],
    returnHops: f.returnHops,
    via: 'local',
  };
}

// ---------- Latency ----------

/** Approximate round-trip time from a city to us-east-1 and to the nearest CloudFront edge. */
export const CITY_RTT: Record<string, { region: number; edge: number; label: string }> = {
  virginia: { region: 8, edge: 6, label: 'Virginia' },
  london: { region: 76, edge: 8, label: 'London' },
  saopaulo: { region: 120, edge: 10, label: 'São Paulo' },
  tokyo: { region: 160, edge: 8, label: 'Tokyo' },
  sydney: { region: 200, edge: 10, label: 'Sydney' },
};

// ---------- Public entry ----------

function serviceEndpoint(board: Board, to: Endpoint): External | null {
  if (to === 'internet') return { kind: 'external', ip: INTERNET_IP, label: `an internet host (${INTERNET_IP})` };
  if (to === 'svc:s3') return { kind: 'external', ip: SERVICE_IPS.s3, label: 'Amazon S3', service: 's3' };
  if (to === 'svc:dynamodb') return { kind: 'external', ip: SERVICE_IPS.dynamodb, label: 'Amazon DynamoDB', service: 'dynamodb' };
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
  const p = flow.protocol;
  const city = CITY_RTT[flow.clientCity ?? 'virginia'] ?? CITY_RTT.virginia;

  // ----- From the internet -----
  if (flow.from === 'internet') {
    const dst = board.components[flow.to];
    if (!dst) return dropped([{ at: { kind: 'internet', id: 'internet' }, check: 'exists', result: 'deny', explain: `There is nothing on the board to send traffic to.` }]);
    return traceFromInternet(board, dst, p, flow.port, city, opts, []);
  }

  const src = board.components[flow.from];
  if (!src) return dropped([{ at: { kind: 'internet', id: 'internet' }, check: 'exists', result: 'deny', explain: `The source isn't on the board.` }]);

  // Regional serverless services (non-VPC Lambda, API Gateway) run in AWS-managed networks.
  if (src.placement.kind !== 'subnet') {
    return {
      result: 'delivered',
      hops: [{ at: { kind: 'component', id: src.id }, check: 'route', result: 'info', explain: `${src.name} runs outside your VPC in an AWS-managed network with access to public AWS endpoints. Network-level checks don't apply; permissions (IAM) arrive in Stage 2.` }],
      returnHops: [],
      via: 'none',
    };
  }

  const srcEnis = enisOf(board, src, failed);
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
      t = { result: l.ok ? 'delivered' : 'dropped', hops: l.hops, returnHops: l.returnHops, via: l.via };
    } else {
      const dEnis = enisOf(board, dstComp!, failed).sort((a, b) => (a.azId === s.azId ? -1 : 0) - (b.azId === s.azId ? -1 : 0));
      if (!dEnis.length) {
        t = dropped([{ at: { kind: 'component', id: dstComp!.id }, check: 'az', result: 'deny', explain: `${dstComp!.name} has no running interface in a working Availability Zone.` }]);
      } else {
        t = dropped([]);
        for (const d of dEnis) {
          const l = leg(board, s, d, p, flow.port, opts);
          let cand: Trace = { result: l.ok ? 'delivered' : 'dropped', hops: l.hops, returnHops: l.returnHops, via: l.via };
          if (l.ok && dstComp!.type === 'alb') {
            const second = albToTargets(board, dstComp!, [d], p, opts);
            cand = { result: second.ok ? 'delivered' : 'dropped', hops: [...l.hops, ...second.hops], returnHops: [...second.returnHops, ...l.returnHops], via: 'local' };
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

function traceFromInternet(board: Board, dst: Component, p: Protocol, port: number, city: { region: number; edge: number; label: string }, opts: TraceOptions, prefix: Hop[]): Trace {
  const failed = opts.failedAzs ?? [];
  const hops = [...prefix];
  const cfg = dst.config;

  if (cfg.type === 'route53') {
    const target = cfg.aliasTargetId ? board.components[cfg.aliasTargetId] : undefined;
    if (!target) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'dns', result: 'deny', explain: `${cfg.recordName}: the record has no alias target, so DNS returns NXDOMAIN.` }]);
    hops.push({ at: { kind: 'component', id: dst.id }, check: 'dns', result: 'allow', explain: `Route 53 answers ${cfg.recordName} with an alias to ${target.name}. Alias records to AWS resources are free to query and follow IP changes automatically.` });
    return traceFromInternet(board, target, p, port, city, opts, hops);
  }

  if (cfg.type === 'cloudfront') {
    if (port === 80 && cfg.viewerProtocol === 'https-only') return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'edge', result: 'deny', explain: `${dst.name} only accepts HTTPS.` }]);
    hops.push({ at: { kind: 'component', id: dst.id }, check: 'edge', result: 'allow', explain: `The viewer in ${city.label} connects to the nearest CloudFront edge location (~${city.edge} ms RTT). TLS terminates at the edge.` });
    const origin = cfg.originId ? board.components[cfg.originId] : undefined;
    if (!origin) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'origin', result: 'deny', explain: `${dst.name} has no origin configured. Every cache miss returns HTTP 502.` }]);
    const missRtt = city.region; // edge -> origin over the AWS backbone, roughly the same distance
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
      const t = traceFromInternet(board, origin, p, 443, city, opts, hops);
      return { ...t, latencyMs: latency };
    }
    return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'origin', result: 'deny', explain: `${origin.name} can't be a CloudFront origin here.` }]);
  }

  if (cfg.type === 's3') {
    const latency = city.region;
    if (cfg.blockPublicAccess) return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'origin', result: 'deny', matched: { objectId: dst.id, ruleRef: 'Block Public Access' }, explain: `403 AccessDenied: Block Public Access is on for ${dst.name}, so anonymous requests are refused whatever the policy says.` }]);
    if (cfg.policy !== 'public-read') return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'origin', result: 'deny', matched: { objectId: dst.id, ruleRef: 'bucket policy' }, explain: `403 AccessDenied: no bucket policy grants anonymous s3:GetObject on ${dst.name}.` }]);
    hops.push({ at: { kind: 'component', id: dst.id }, check: 'origin', result: 'allow', explain: `${dst.name} is publicly readable. Every request travels to us-east-1 (~${latency} ms RTT from ${city.label}).` });
    return { result: 'delivered', hops, returnHops: [], via: 'igw', latencyMs: latency };
  }

  if (cfg.type === 'apigw' || cfg.type === 'sqs' || cfg.type === 'lambda' || cfg.type === 'dynamodb') {
    hops.push({ at: { kind: 'component', id: dst.id }, check: 'edge', result: 'info', explain: `${dst.name} is a public regional endpoint. Network reachability is not the control here; authentication and IAM are (Stage 2).` });
    return { result: 'delivered', hops, returnHops: [], via: 'none', latencyMs: city.region };
  }

  if (dst.placement.kind !== 'subnet') return dropped([...hops, { at: { kind: 'component', id: dst.id }, check: 'exists', result: 'deny', explain: `${dst.name} does not accept connections from the internet.` }]);

  const enis = enisOf(board, dst, failed);
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
