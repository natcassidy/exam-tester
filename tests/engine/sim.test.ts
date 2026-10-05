import { describe, expect, it } from 'vitest';
import type { AsgConfig } from '../../src/engine/model';
import { createBoardFromLayout, defaultConfig, placeComponent } from '../../src/engine/board';
import { BoardBuilder } from '../../src/engine/builder';
import { simulateAsg, readyDelayMin } from '../../src/engine/sim/capacity';
import { computeAzOutage } from '../../src/engine/sim/failure';
import { ledgerly } from '../../src/content/missions/ledgerly';
import { northwind } from '../../src/content/missions/northwind';
import { estimateCost } from '../../src/engine/cost/estimate';
import { scoreResults } from '../../src/engine/scoring';
import { runMission } from '../../src/engine/sim/runner';
import { portfolio } from '../../src/content/missions/portfolio';

describe('ASG warmup timing', () => {
  const cfg: AsgConfig = { ...(defaultConfig('asg') as AsgConfig), min: 2, desired: 2, max: 10, warmupSec: 300, policy: { kind: 'targetTracking', targetCpu: 50 } };
  it('new instances add capacity only after boot + warmup', () => {
    // Step from 100 to 600 rps at minute 1.
    const sim = simulateAsg(cfg, [{ min: 0, rps: 100 }, { min: 1, rps: 600 }, { min: 30, rps: 600 }], 30);
    const launchedAt = sim.marks.find((m) => m.label.includes('launching'))!.min;
    expect(launchedAt).toBe(1);
    const readyAt = launchedAt + readyDelayMin(cfg); // 1 + 1 + 5 = 7
    expect(sim.points[readyAt - 1].instances).toBe(2);
    expect(sim.points[readyAt].instances).toBeGreaterThan(2);
    expect(sim.points[readyAt - 1].errors).toBeGreaterThan(0);
  });

  it('a shorter warmup recovers sooner', () => {
    const slow = simulateAsg(cfg, [{ min: 0, rps: 100 }, { min: 1, rps: 600 }], 30);
    const fast = simulateAsg({ ...cfg, warmupSec: 60 }, [{ min: 0, rps: 100 }, { min: 1, rps: 600 }], 30);
    expect(fast.totalErrors).toBeLessThan(slow.totalErrors);
  });

  it('never exceeds max capacity', () => {
    const sim = simulateAsg({ ...cfg, max: 3 }, [{ min: 0, rps: 5000 }], 20);
    expect(sim.maxInstances).toBe(3);
    expect(sim.totalErrors).toBeGreaterThan(0);
  });
});

describe('RTO/RPO for an AZ outage', () => {
  const p = { az: 'us-east-1a', loadRps: 400, rtoSec: 300, rpoSec: 60 };
  const db = (b: ReturnType<typeof computeAzOutage>) => b.tiers.find((t) => t.tier === 'Database')!;

  it('Multi-AZ: ~90s failover, RPO 0', () => {
    const o = computeAzOutage(ledgerly.reference, p);
    expect(db(o)).toMatchObject({ rtoSec: 90, rpoSec: 0 });
  });

  it('Single-AZ with backups: point-in-time restore, RPO 5 min', () => {
    const b = BoardBuilder.from(ledgerly.reference).config('ledger-db', { multiAz: false, backupRetentionDays: 7, allocatedStorageGb: 100 }).done();
    const d = db(computeAzOutage(b, p));
    expect(d.rtoSec).toBeGreaterThanOrEqual(30 * 60);
    expect(d.rtoSec).toBeLessThanOrEqual(60 * 60);
    expect(d.rpoSec).toBe(300);
  });

  it('Single-AZ without backups: total data loss', () => {
    const b = BoardBuilder.from(ledgerly.reference).config('ledger-db', { multiAz: false, backupRetentionDays: 0 }).done();
    const d = db(computeAzOutage(b, p));
    expect(d.rtoSec).toBe(Infinity);
    expect(d.rpoSec).toBe(Infinity);
  });

  it('primary outside the failed AZ is unaffected', () => {
    const b = BoardBuilder.from(ledgerly.reference).config('ledger-db', { multiAz: false }).done();
    expect(db(computeAzOutage(b, { ...p, az: 'us-east-1b' }))).toMatchObject({ rtoSec: 0, rpoSec: 0 });
  });

  it('static stability: a group sized at exactly 100% across two AZs is overloaded after losing one', () => {
    const b = BoardBuilder.from(ledgerly.reference).config('app-asg', { min: 2, desired: 2 }).done();
    const compute = computeAzOutage(b, { ...p, loadRps: 500 }).tiers.find((t) => t.tier === 'Compute')!;
    expect(compute.status).toBe('warn');
    expect(compute.rtoSec).toBe(60 + 60 + 180); // ELB detection + launch + warmup
    expect(compute.explain).toMatch(/static stability/i);
  });

  it('ALB detection time is interval × unhealthy threshold', () => {
    const lb = computeAzOutage(ledgerly.reference, p).tiers.find((t) => t.tier === 'Load balancer')!;
    expect(lb.rtoSec).toBe(60);
  });
});

describe('NAT data processing cost', () => {
  it('S3 traffic through a NAT costs $0.045/GB; through a gateway endpoint it is free', () => {
    const viaNat = northwind.mistakes.find((m) => m.name.startsWith('No gateway endpoint'))!.board;
    const natItems = estimateCost(viaNat, northwind.usage).items.filter((i) => i.item.startsWith('NAT data processing') && i.item.includes('S3'));
    expect(natItems.reduce((s, i) => s + i.monthly, 0)).toBeCloseTo(20000 * 0.045, 2); // $900
    const ref = estimateCost(northwind.reference, northwind.usage).items.filter((i) => i.item.startsWith('NAT data processing') && i.item.includes('S3'));
    expect(ref).toEqual([]);
  });

  it('an endpoint on one of two route tables only saves half', () => {
    const half = northwind.mistakes.find((m) => m.name.includes('only one'))!.board;
    const items = estimateCost(half, northwind.usage).items.filter((i) => i.item.startsWith('NAT data processing') && i.item.includes('S3'));
    expect(items.reduce((s, i) => s + i.monthly, 0)).toBeCloseTo(450, 2);
  });
});

describe('scoring', () => {
  it('3 stars only when everything passes', () => {
    const evs = [{ id: 'a', domain: 'secure' }, { id: 'b', domain: 'cost' }] as any;
    expect(scoreResults(evs, [{ eventId: 'a', status: 'pass' }, { eventId: 'b', status: 'pass' }] as any).stars).toBe(3);
    expect(scoreResults(evs, [{ eventId: 'a', status: 'pass' }, { eventId: 'b', status: 'warn' }] as any).stars).toBe(2);
    expect(scoreResults(evs, [{ eventId: 'a', status: 'pass' }, { eventId: 'b', status: 'fail' }] as any).stars).toBe(1);
    expect(scoreResults(evs, [{ eventId: 'a', status: 'fail' }, { eventId: 'b', status: 'fail' }] as any).stars).toBe(0);
  });

  it('no stars while an event has nothing to test', () => {
    const evs = [{ id: 'a', domain: 'secure' }, { id: 'b', domain: 'cost' }] as any;
    const s = scoreResults(evs, [{ eventId: 'a', status: 'pass' }, { eventId: 'b', status: 'fail', incomplete: true }] as any);
    expect(s).toMatchObject({ stars: 0, points: 50, incomplete: true });
  });

  it('a lone default bucket earns no star on the portfolio mission', () => {
    const board = createBoardFromLayout(portfolio.layout);
    const placed = placeComponent(board, 's3', { kind: 'region', refId: board.regions[0].id }, portfolio.defaults);
    if (!placed.ok) throw new Error(placed.error);
    const s = scoreResults(portfolio.events, runMission(placed.board, portfolio));
    expect(s.passed * 2).toBeGreaterThanOrEqual(s.total); // the audit, the bill and the scraper pass…
    expect(s.stars).toBe(0); // …but visitors have nothing to load yet
  });
});
