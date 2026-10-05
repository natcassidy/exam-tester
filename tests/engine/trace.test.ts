import { describe, expect, it } from 'vitest';
import { BoardBuilder } from '../../src/engine/builder';
import { ledgerly, ledgerlyLayout } from '../../src/content/missions/ledgerly';
import { northwind } from '../../src/content/missions/northwind';
import { traceFlow, failingHop } from '../../src/engine/net/trace';
import { createNacl, associateSubnet, addNaclRule, clone } from '../../src/engine/board';
import type { Board } from '../../src/engine/model';
import { subnetPublicStatus, findSubnet } from '../../src/engine/net/routing';

const id = (b: Board, name: string) => Object.values(b.components).find((c) => c.name === name)!.id;
const ok = (r: { ok: true; board: Board; id?: string } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('derived public/private labels', () => {
  it('a subnet is public only because of its route table', () => {
    const b = clone(ledgerly.reference);
    expect(subnetPublicStatus(b, findSubnet(b, 'public-a')!.subnet)).toEqual({ isPublic: true, reason: 'Public: 0.0.0.0/0 → igw-1 in rtb-public' });
    b.routeTables['rtb-public'].routes = b.routeTables['rtb-public'].routes.filter((r) => r.dest !== '0.0.0.0/0');
    expect(subnetPublicStatus(b, findSubnet(b, 'public-a')!.subnet).isPublic).toBe(false);
  });
});

describe('trace through an internet gateway', () => {
  it('needs a public IP for internet egress', () => {
    const withIp = new BoardBuilder(ledgerlyLayout).place('ec2', 'public-a', { name: 'bastion', config: { publicIp: true } as any }).done();
    const t = traceFlow(withIp, { from: id(withIp, 'bastion'), to: 'internet', protocol: 'tcp', port: 443 });
    expect(t.result).toBe('delivered');
    expect(t.via).toBe('igw');

    const noIp = new BoardBuilder(ledgerlyLayout).place('ec2', 'public-a', { name: 'bastion' }).done();
    const t2 = traceFlow(noIp, { from: id(noIp, 'bastion'), to: 'internet', protocol: 'tcp', port: 443 });
    expect(t2.result).toBe('dropped');
    expect(failingHop(t2)?.check).toBe('public-ip');
  });

  it('reports a missing route with the route table name', () => {
    const b = new BoardBuilder(ledgerlyLayout).place('ec2', 'app-a', { name: 'worker' }).done();
    const t = traceFlow(b, { from: id(b, 'worker'), to: 'internet', protocol: 'tcp', port: 443 });
    expect(failingHop(t)?.explain).toMatch(/No route to 203\.0\.113\.10 in rtb-private-a/);
  });
});

describe('trace through a NAT gateway', () => {
  it('private instances reach the internet via the NAT in their AZ', () => {
    const b = ledgerly.reference;
    const t = traceFlow(b, { from: id(b, 'app-asg'), to: 'internet', protocol: 'tcp', port: 443 });
    expect(t.result).toBe('delivered');
    expect(t.paths?.map((p) => p.via)).toEqual(['nat', 'nat']);
    expect(t.hops.some((h) => h.check === 'nat' && h.result === 'allow')).toBe(true);
  });

  it('a NAT whose subnet has no IGW route drops traffic', () => {
    const b = clone(ledgerly.reference);
    b.routeTables['rtb-public'].routes = b.routeTables['rtb-public'].routes.filter((r) => r.dest !== '0.0.0.0/0');
    const t = traceFlow(b, { from: id(b, 'app-asg'), to: 'internet', protocol: 'tcp', port: 443 });
    expect(t.result).toBe('dropped');
    expect(failingHop(t)?.check).toBe('nat');
  });

  it('a NAT in a failed AZ strands subnets that route to it', () => {
    const b = clone(ledgerly.reference);
    b.routeTables['rtb-private-b'].routes.find((r) => r.dest === '0.0.0.0/0')!.target = { nat: id(b, 'nat-a') };
    const t = traceFlow(b, { from: id(b, 'app-asg'), to: 'internet', protocol: 'tcp', port: 443 }, { failedAzs: ['us-east-1a'] });
    expect(t.result).toBe('dropped');
    expect(failingHop(t)?.explain).toMatch(/AZ-scoped/);
  });
});

describe('trace through a gateway endpoint', () => {
  it('S3 traffic uses the endpoint when the route table is associated (longest prefix beats 0.0.0.0/0)', () => {
    const b = northwind.reference;
    const t = traceFlow(b, { from: id(b, 'batch-fleet'), to: 'svc:s3', protocol: 'tcp', port: 443 });
    expect(t.result).toBe('delivered');
    expect(t.paths?.map((p) => p.via)).toEqual(['vpce', 'vpce']);
  });

  it('a route table without the association still sends S3 traffic to the NAT', () => {
    const b = northwind.mistakes.find((m) => m.name.includes('only one'))!.board;
    const t = traceFlow(b, { from: id(b, 'batch-fleet'), to: 'svc:s3', protocol: 'tcp', port: 443 });
    expect(t.paths?.map((p) => [p.subnetId, p.via])).toEqual([
      ['batch-a', 'vpce'],
      ['batch-b', 'nat'],
    ]);
  });
});

describe('trace through an ALB', () => {
  it('is two connections: client → listener, then ALB node → healthy target', () => {
    const b = ledgerly.reference;
    const t = traceFlow(b, { from: 'internet', to: id(b, 'web-alb'), protocol: 'tcp', port: 443 });
    expect(t.result).toBe('delivered');
    const checks = t.hops.map((h) => h.check);
    expect(checks.indexOf('lb-listener')).toBeGreaterThan(-1);
    expect(checks.indexOf('lb-target-health')).toBeGreaterThan(checks.indexOf('lb-listener'));
    // The second leg checks the target SG against the ALB SG.
    expect(t.hops.some((h) => h.check === 'sg-in' && /from web-alb/.test(h.explain))).toBe(true);
  });

  it('wrong listener port is refused', () => {
    const b = ledgerly.reference;
    const t = traceFlow(b, { from: 'internet', to: id(b, 'web-alb'), protocol: 'tcp', port: 80 });
    expect(failingHop(t)?.check).toBe('lb-listener');
  });

  it('health check path mismatch leaves 0 healthy targets (503)', () => {
    const b = BoardBuilder.from(ledgerly.reference).config('web-alb', { healthCheck: { path: '/healthz', intervalSec: 30, timeoutSec: 5, healthyThreshold: 5, unhealthyThreshold: 2 } }).done();
    const t = traceFlow(b, { from: 'internet', to: id(b, 'web-alb'), protocol: 'tcp', port: 443 });
    expect(failingHop(t)?.check).toBe('lb-target-health');
    expect(failingHop(t)?.explain).toMatch(/503/);
  });

  it('target SG must allow the ALB SG', () => {
    const b = BoardBuilder.from(ledgerly.reference).clearSg('app-asg', 'inbound').done();
    const t = traceFlow(b, { from: 'internet', to: id(b, 'web-alb'), protocol: 'tcp', port: 443 });
    expect(t.result).toBe('dropped');
    expect(failingHop(t)?.check).toBe('sg-in');
  });

  it('picks a surviving path when an AZ fails', () => {
    const b = ledgerly.reference;
    const t = traceFlow(b, { from: 'internet', to: id(b, 'web-alb'), protocol: 'tcp', port: 443 }, { failedAzs: ['us-east-1a'] });
    expect(t.result).toBe('delivered');
    expect(t.hops.every((h) => !/us-east-1a\)/.test(h.explain))).toBe(true);
  });
});

describe('SG statefulness vs NACL ephemeral return traffic', () => {
  function withAppNacl(outbound: boolean) {
    let b = clone(ledgerly.reference);
    const r = ok(createNacl(b, 'vpc-ledgerly', 'nacl-app'));
    b = r.board;
    const n = r.id!;
    b = ok(addNaclRule(b, n, 'inbound', { ruleNumber: 100, protocol: 'tcp', portRange: [443, 443], cidr: '10.0.0.0/16', action: 'allow' })).board;
    if (outbound) b = ok(addNaclRule(b, n, 'outbound', { ruleNumber: 100, protocol: 'tcp', portRange: [1024, 65535], cidr: '10.0.0.0/16', action: 'allow' })).board;
    b = ok(associateSubnet(b, 'app-a', 'naclId', n)).board;
    b = ok(associateSubnet(b, 'app-b', 'naclId', n)).board;
    return b;
  }

  it('a NACL that allows 443 in but no ephemeral ports out drops the response', () => {
    const b = withAppNacl(false);
    const t = traceFlow(b, { from: 'internet', to: id(b, 'web-alb'), protocol: 'tcp', port: 443 });
    expect(t.result).toBe('dropped');
    const bad = failingHop(t)!;
    expect(t.returnHops).toContain(bad);
    expect(bad.check).toBe('nacl-out');
    expect(bad.matched?.ruleRef).toBe('outbound rule *');
    expect(bad.explain).toMatch(/stateless/);
  });

  it('adding outbound 1024-65535 fixes it', () => {
    const b = withAppNacl(true);
    expect(traceFlow(b, { from: 'internet', to: id(b, 'web-alb'), protocol: 'tcp', port: 443 }).result).toBe('delivered');
  });

  it('an SG with no outbound rules still lets responses out (stateful)', () => {
    const b = BoardBuilder.from(ledgerly.reference).clearSg('app-asg', 'outbound').done();
    const t = traceFlow(b, { from: 'internet', to: id(b, 'web-alb'), protocol: 'tcp', port: 443 });
    expect(t.result).toBe('delivered');
    expect(t.returnHops.some((h) => h.result === 'info' && /stateful/.test(h.explain))).toBe(true);
  });
});
