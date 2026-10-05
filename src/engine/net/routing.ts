import type { Board, Route, RouteTable, RouteTarget, Subnet, Vpc } from '../model';
import { cidrContainsIp, isValidCidr, parseCidr } from './cidr';

/** AWS-managed prefix lists (approximate us-east-1 ranges). */
export const PREFIX_LISTS: Record<string, { name: string; service: 's3' | 'dynamodb'; cidrs: string[] }> = {
  'pl-s3': { name: 'com.amazonaws.us-east-1.s3', service: 's3', cidrs: ['52.216.0.0/15', '54.231.0.0/16', '3.5.0.0/19'] },
  'pl-dynamodb': { name: 'com.amazonaws.us-east-1.dynamodb', service: 'dynamodb', cidrs: ['52.94.0.0/22', '52.119.224.0/20'] },
};

export const SERVICE_IPS: Record<'s3' | 'dynamodb', string> = {
  s3: '52.216.10.20',
  dynamodb: '52.94.0.50',
};

export const INTERNET_IP = '203.0.113.10';

export function targetLabel(t: RouteTarget): string {
  if (t === 'local') return 'local';
  const [k, v] = Object.entries(t)[0];
  return `${k}:${v}`;
}

export function targetKind(t: RouteTarget): 'local' | 'igw' | 'nat' | 'vpce' | 'pcx' | 'tgw' | 'vgw' {
  if (t === 'local') return 'local';
  return Object.keys(t)[0] as 'igw' | 'nat' | 'vpce' | 'pcx' | 'tgw' | 'vgw';
}

export function targetId(t: RouteTarget): string | null {
  if (t === 'local') return null;
  return Object.values(t)[0];
}

/** Routes in a table, including routes propagated by gateway endpoint associations. */
export function effectiveRoutes(board: Board, rtId: string): Route[] {
  const rt = board.routeTables[rtId];
  if (!rt) return [];
  const routes = rt.routes.filter((r) => !r.propagated);
  for (const c of Object.values(board.components)) {
    if (c.config.type === 'vpce' && c.config.routeTableIds.includes(rtId)) {
      routes.push({ dest: c.config.service === 's3' ? 'pl-s3' : 'pl-dynamodb', target: { vpce: c.id }, propagated: true });
    }
  }
  return routes;
}

/** Prefix length a route destination offers for an IP, or -1 if it doesn't match. */
function matchPrefix(dest: string, ip: string): number {
  const pl = PREFIX_LISTS[dest];
  if (pl) {
    let best = -1;
    for (const c of pl.cidrs) if (cidrContainsIp(c, ip)) best = Math.max(best, parseCidr(c).prefix);
    return best;
  }
  if (!isValidCidr(dest)) return -1;
  return cidrContainsIp(dest, ip) ? parseCidr(dest).prefix : -1;
}

export interface RouteMatch {
  route: Route;
  index: number;
  routes: Route[];
}

/** Longest-prefix match over the table's effective routes. */
export function resolveRoute(board: Board, rtId: string, destIp: string): RouteMatch | null {
  const routes = effectiveRoutes(board, rtId);
  let best: RouteMatch | null = null;
  let bestPrefix = -1;
  routes.forEach((route, index) => {
    const p = matchPrefix(route.dest, destIp);
    if (p > bestPrefix) {
      bestPrefix = p;
      best = { route, index, routes };
    }
  });
  return best;
}

export function findSubnet(board: Board, subnetId: string): { subnet: Subnet; vpc: Vpc } | null {
  for (const r of board.regions)
    for (const vpc of r.vpcs)
      for (const az of vpc.azs)
        for (const s of az.subnets) if (s.id === subnetId) return { subnet: s, vpc };
  return null;
}

export function allSubnets(board: Board): Subnet[] {
  return board.regions.flatMap((r) => r.vpcs.flatMap((v) => v.azs.flatMap((a) => a.subnets)));
}

export function allVpcs(board: Board): Vpc[] {
  return board.regions.flatMap((r) => r.vpcs);
}

export function vpcOfRouteTable(board: Board, rt: RouteTable): Vpc | undefined {
  return allVpcs(board).find((v) => v.id === rt.vpcId);
}

export interface PublicStatus {
  isPublic: boolean;
  reason: string;
}

/** "Public" is derived from the route table: a 0.0.0.0/0 route to an internet gateway. */
export function subnetPublicStatus(board: Board, subnet: Subnet): PublicStatus {
  const rt = board.routeTables[subnet.routeTableId];
  if (!rt) return { isPublic: false, reason: 'No route table associated' };
  const def = rt.routes.find((r) => r.dest === '0.0.0.0/0');
  if (def && targetKind(def.target) === 'igw') {
    const igwId = targetId(def.target)!;
    if (board.components[igwId]) return { isPublic: true, reason: `Public: 0.0.0.0/0 → ${board.components[igwId].name} in ${rt.name}` };
    return { isPublic: false, reason: `Private: 0.0.0.0/0 → ${igwId} is a blackhole (gateway deleted)` };
  }
  if (def && targetKind(def.target) === 'nat') {
    const nat = board.components[targetId(def.target)!];
    return { isPublic: false, reason: `Private: 0.0.0.0/0 → ${nat ? nat.name : 'deleted NAT (blackhole)'} in ${rt.name}` };
  }
  return { isPublic: false, reason: `Private: no 0.0.0.0/0 → igw route in ${rt.name}` };
}

export function isPublicSubnet(board: Board, subnetId: string): boolean {
  const f = findSubnet(board, subnetId);
  return !!f && subnetPublicStatus(board, f.subnet).isPublic;
}

export function azOfSubnet(board: Board, subnetId: string): string | null {
  return findSubnet(board, subnetId)?.subnet.azId ?? null;
}

/** Route targets that are valid choices in a table's editor. */
export function validTargets(board: Board, rt: RouteTable): { label: string; target: RouteTarget }[] {
  const out: { label: string; target: RouteTarget }[] = [{ label: 'local', target: 'local' }];
  for (const c of Object.values(board.components)) {
    if (c.type === 'igw' && c.placement.refId === rt.vpcId) out.push({ label: `${c.name} (internet gateway)`, target: { igw: c.id } });
    if (c.type === 'nat') {
      const s = c.placement.kind === 'subnet' ? findSubnet(board, c.placement.refId) : null;
      if (s && s.vpc.id === rt.vpcId) out.push({ label: `${c.name} (NAT gateway)`, target: { nat: c.id } });
    }
  }
  return out;
}
