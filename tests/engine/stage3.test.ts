import { describe, expect, it } from 'vitest';
import type { VpcLayout, VpcSpec } from '../../src/engine/model';
import { BoardBuilder } from '../../src/engine/builder';
import { traceFlow, failingHop } from '../../src/engine/net/trace';
import { resolveDns } from '../../src/engine/net/dns';
import { computeRegionOutage } from '../../src/engine/sim/dr';
import { drRegion } from '../../src/content/missions/drRegion';
import { twelveVpcs } from '../../src/content/missions/twelveVpcs';
import { branchOffice } from '../../src/content/missions/branchOffice';
import { resolveRef } from '../../src/engine/select';

const vpc = (key: string, cidr: string): VpcSpec => ({
  id: `vpc-${key}`,
  name: key,
  cidr,
  azs: [{ id: 'us-east-1a', name: 'us-east-1a' }],
  routeTables: [{ id: `rtb-${key}`, name: `rtb-${key}`, routes: [] }],
  subnets: [{ id: `${key}-a`, name: `${key}-a`, cidr: cidr.replace('0.0/16', '10.0/24'), az: 'us-east-1a', tier: 'app', routeTableId: `rtb-${key}` }],
});
const r = { regionId: 'us-east-1', regionName: 'US East (N. Virginia)' };
const layout: VpcLayout = {
  ...r,
  vpc: vpc('a', '10.0.0.0/16'),
  extraVpcs: [
    { ...r, vpc: vpc('b', '10.1.0.0/16') },
    { ...r, vpc: vpc('c', '10.2.0.0/16') },
    { ...r, vpc: vpc('d', '10.0.0.0/16') },
  ],
};

function chain(): BoardBuilder {
  const b = new BoardBuilder(layout, 'bare');
  for (const k of ['a', 'b', 'c']) b.place('ec2', `${k}-a`, { name: `host-${k}` }).sgRule(`host-${k}`, 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '10.0.0.0/8' } });
  return b
    .place('pcx', 'vpc-a', { name: 'a-b' })
    .config('a-b', { peerVpcId: 'vpc-b' })
    .place('pcx', 'vpc-b', { name: 'b-c' })
    .config('b-c', { peerVpcId: 'vpc-c' })
    .route('rtb-a', '10.1.0.0/16', { pcxName: 'a-b' })
    .route('rtb-a', '10.2.0.0/16', { pcxName: 'a-b' })
    .route('rtb-b', '10.0.0.0/16', { pcxName: 'a-b' })
    .route('rtb-b', '10.2.0.0/16', { pcxName: 'b-c' })
    .route('rtb-c', '10.1.0.0/16', { pcxName: 'b-c' })
    .route('rtb-c', '10.0.0.0/16', { pcxName: 'b-c' });
}

const flow = (b: BoardBuilder, from: string, to: string, port = 443) => traceFlow(b.board, { from: b.id(from), to: b.id(to), protocol: 'tcp', port });

describe('VPC peering', () => {
  it('connects two peered VPCs with routes on both sides', () => {
    expect(flow(chain(), 'host-a', 'host-b').result).toBe('delivered');
    expect(flow(chain(), 'host-b', 'host-c').result).toBe('delivered');
  });

  it('is not transitive: A cannot reach C through B', () => {
    const t = flow(chain(), 'host-a', 'host-c');
    expect(t.result).toBe('dropped');
    expect(failingHop(t)?.explain).toMatch(/transitive/i);
  });

  it('needs the return route', () => {
    const t = flow(chain().removeRoute('rtb-b', '10.0.0.0/16'), 'host-a', 'host-b');
    expect(t.result).toBe('dropped');
  });

  it('rejects peering VPCs with overlapping CIDRs', () => {
    const b = new BoardBuilder(layout, 'bare').place('pcx', 'vpc-a', { name: 'a-d' });
    expect(() => b.config('a-d', { peerVpcId: 'vpc-d' })).toThrow(/overlap/i);
  });
});

describe('Transit Gateway route tables', () => {
  const ref = BoardBuilder.from(twelveVpcs.reference, 'bare');
  const t = (board: typeof twelveVpcs.reference, from: string, to: string, port: number) =>
    traceFlow(board, { from: from === 'onprem' ? 'onprem' : resolveRef(board, from)!.id, to: resolveRef(board, to)!.id, protocol: 'tcp', port });

  it('lets prod and dev reach shared services', () => {
    expect(t(ref.board, 'ec2#vpc-prod', 'ec2#vpc-shared', 636).result).toBe('delivered');
    expect(t(ref.board, 'ec2#vpc-dev', 'ec2#vpc-shared', 636).result).toBe('delivered');
  });

  it('segments dev from prod with separate route tables', () => {
    const tr = t(ref.board, 'ec2#vpc-dev', 'ec2#vpc-prod', 443);
    expect(tr.result).toBe('dropped');
    expect(failingHop(tr)?.check).toBe('tgw');
  });

  it('routes everything to everything with a single route table', () => {
    const single = twelveVpcs.mistakes.find((m) => /One TGW route table/.test(m.name))!.board;
    expect(t(single, 'ec2#vpc-dev', 'ec2#vpc-prod', 443).result).toBe('delivered');
  });

  it('reaches prod from on-premises over the VPN attachment, and fails without propagation', () => {
    expect(t(ref.board, 'onprem', 'ec2#vpc-prod', 443).result).toBe('delivered');
    const noProp = twelveVpcs.mistakes.find((m) => /not propagated/.test(m.name))!.board;
    expect(t(noProp, 'onprem', 'ec2#vpc-prod', 443).result).toBe('dropped');
  });
});

describe('On-premises over VPN and Direct Connect', () => {
  const board = branchOffice.reference;
  const ec2 = resolveRef(board, 'ec2')!.id;
  const names = (id?: string) => (id ? board.components[id].name : undefined);

  it('prefers Direct Connect and fails over to the VPN', () => {
    const t1 = traceFlow(board, { from: 'onprem', to: ec2, protocol: 'tcp', port: 443 });
    expect(t1.result).toBe('delivered');
    expect(names(t1.linkId)).toBe('office-dx');
    const dx = resolveRef(board, 'dx')!.id;
    const t2 = traceFlow(board, { from: 'onprem', to: ec2, protocol: 'tcp', port: 443 }, { failedLinks: [dx] });
    expect(t2.result).toBe('delivered');
    expect(names(t2.linkId)).toBe('office-vpn');
  });

  it('drops traffic when the VPC has no route back to the data centre', () => {
    const b = BoardBuilder.from(board, 'bare').removeRoute('rtb-private', '192.168.0.0/16');
    expect(traceFlow(b.board, { from: 'onprem', to: ec2, protocol: 'tcp', port: 443 }).result).toBe('dropped');
  });
});

describe('Route 53 routing policies', () => {
  const b = BoardBuilder.from(drRegion.reference);
  const dnsOf = (board = b.board) => {
    const c = resolveRef(board, 'route53')!.config;
    if (c.type !== 'route53') throw new Error('not route53');
    return c;
  };

  it('failover answers with the primary, then the secondary when its Region fails', () => {
    expect(names(b, resolveDns(b.board, dnsOf()).targetId)).toBe('shop-alb');
    expect(names(b, resolveDns(b.board, dnsOf(), 'virginia', ['us-east-1']).targetId)).toBe('dr-alb');
  });

  it('latency routing picks the closest Region', () => {
    const lb = BoardBuilder.from(drRegion.reference).config('shop-dns', {
      policy: 'latency',
      records: [
        { id: 'x', targetId: 'shop-alb', healthCheck: true },
        { id: 'y', targetId: 'dr-alb', healthCheck: true },
      ],
    });
    expect(names(lb, resolveDns(lb.board, dnsOf(lb.board), 'virginia').targetId)).toBe('shop-alb');
    expect(names(lb, resolveDns(lb.board, dnsOf(lb.board), 'tokyo').targetId)).toBe('dr-alb');
  });

  it('geolocation without a default record answers nothing for unlisted locations', () => {
    const geo = BoardBuilder.from(drRegion.reference).config('shop-dns', { policy: 'geolocation', records: [{ id: 'eu', targetId: 'shop-alb', healthCheck: true, location: 'EU' }] });
    expect(resolveDns(geo.board, dnsOf(geo.board), 'virginia').targetId).toBeFalsy();
    expect(names(geo, resolveDns(geo.board, dnsOf(geo.board), 'london').targetId)).toBe('shop-alb');
  });
});

function names(b: BoardBuilder, id?: string | null) {
  return id ? b.board.components[id].name : undefined;
}

describe('Region outage: RTO, RPO and DR strategy', () => {
  const params = { region: 'us-east-1', loadRps: 400, rtoSec: 3600, rpoSec: 900 };
  const mistake = (re: RegExp) => drRegion.mistakes.find((m) => re.test(m.name))!.board;

  it('backup and restore: RPO is the backup interval', () => {
    const o = computeRegionOutage(mistake(/Backup and restore/), params);
    expect(o.strategy).toBe('backup-restore');
    expect(o.rpoSec).toBe(24 * 3600);
    expect(o.rtoSec).toBeGreaterThan(30 * 60);
  });

  it('pilot light: replica lag for RPO, DNS + fleet launch for RTO', () => {
    const o = computeRegionOutage(drRegion.reference, params);
    expect(o.strategy).toBe('pilot-light');
    expect(o.rpoSec).toBe(60);
    // 90 s health checks + 60 s alias TTL, then max(5 min promotion, 10 min launch + 120 s warmup).
    expect(o.rtoSec).toBe(150 + 720);
  });

  it('warm standby: a running, smaller fleet recovers faster than pilot light', () => {
    const warm = BoardBuilder.from(drRegion.reference).config('dr-asg', { min: 1, desired: 1 }).done();
    const o = computeRegionOutage(warm, params);
    expect(o.strategy).toBe('warm-standby');
    expect(o.rtoSec).toBeLessThan(150 + 720);
  });

  it('multi-site: both Regions serve, recovery is DNS plus promotion', () => {
    const o = computeRegionOutage(mistake(/Multi-site/), params);
    expect(o.strategy).toBe('multi-site');
    expect(o.rtoSec).toBe(150 + 300);
  });

  it('no DR: simple routing never moves users', () => {
    const o = computeRegionOutage(mistake(/Simple routing/), params);
    expect(o.strategy).toBe('none');
    expect(o.rtoSec).toBe(Infinity);
  });
});
