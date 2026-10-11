import { describe, expect, it } from 'vitest';
import { attachSecurityGroups, createBoardFromLayout, renameComponent } from '../../src/engine/board';
import { compareToReference, relevantFirst } from '../../src/engine/assist/compare';
import { ledgerly } from '../../src/content/missions/ledgerly';
import { MISSIONS } from '../../src/content/missions';

describe('compareToReference', () => {
  it.each(MISSIONS.map((m) => [m.id, m] as const))('%s: the reference matches itself', (_id, m) => {
    expect(compareToReference(m.reference, m.reference)).toEqual([]);
  });

  it.each(MISSIONS.map((m) => [m.id, m] as const))('%s: every mistake shows at least one difference', (_id, m) => {
    for (const mistake of m.mistakes) expect(compareToReference(mistake.board, m.reference).length, mistake.name).toBeGreaterThan(0);
  });

  it('a renamed component that is wired the same way is not a difference', () => {
    const ref = ledgerly.reference;
    const asg = Object.values(ref.components).find((c) => c.name === 'app-asg')!;
    const r = renameComponent(ref, asg.id, 'web-fleet');
    if (!r.ok) throw new Error(r.error);
    // The ALB's target, the database's security group source, the WAF association: all still the paired components.
    expect(compareToReference(r.board, ref)).toEqual([]);
  });

  it('an empty board is missing every reference component', () => {
    const empty = createBoardFromLayout(ledgerly.layout);
    const d = compareToReference(empty, ledgerly.reference);
    const fromLayout = Object.values(ledgerly.reference.components).filter((c) => Object.values(empty.components).some((e) => e.type === c.type)).length;
    expect(fromLayout).toBe(1); // the internet gateway comes with the layout
    expect(d.filter((x) => /Your board has none/.test(x.text)).length).toBe(Object.keys(ledgerly.reference.components).length - fromLayout);
  });

  it("names a borrowed security group (the load balancer's group on the app servers)", () => {
    const ref = ledgerly.reference;
    const byName = (n: string) => Object.values(ref.components).find((c) => c.name === n)!;
    const asg = byName('app-asg');
    const r = attachSecurityGroups(ref, asg.id, [...asg.securityGroupIds!, byName('web-alb').securityGroupIds![0]]);
    if (!r.ok) throw new Error(r.error);
    const d = compareToReference(r.board, ref);
    const borrowed = d.find((x) => /app-asg carries alb-sg, web-alb's security group/.test(x.text));
    expect(borrowed?.playerTarget).toBe(asg.id);
    expect(d.some((x) => /allows TCP 443 from 0\.0\.0\.0\/0/.test(x.text))).toBe(true);
    // Borrowing a group doesn't make the chained rule (app-sg ← alb-sg) look different, and the ALB itself is fine.
    expect(d.map((x) => x.text).join('\n')).not.toMatch(/Nothing on app-asg allows|web-alb carries/);
    expect(d).toHaveLength(2);
  });

  it('describes a missing chained rule in terms of roles, not ids', () => {
    const bad = ledgerly.mistakes.find((m) => m.name === 'Single NAT gateway for both AZs')!.board;
    const d = compareToReference(bad, ledgerly.reference);
    expect(d.some((x) => /rtb-private-b 0\.0\.0\.0\/0: the reference routes to nat-b \(us-east-1b\), yours to nat-a \(us-east-1a\)/.test(x.text))).toBe(true);
  });

  it('puts the differences about the failing components first', () => {
    const bad = ledgerly.mistakes.find((m) => m.name === 'Single-AZ database')!.board;
    const { relevant, other } = relevantFirst(compareToReference(bad, ledgerly.reference), ['rds']);
    expect(relevant.length).toBeGreaterThan(0);
    expect(relevant.every((x) => x.types.includes('rds'))).toBe(true);
    expect(relevant.some((x) => /multi az: the reference uses on, yours is off/.test(x.text))).toBe(true);
    expect(other.every((x) => !x.types.includes('rds'))).toBe(true);
  });
});

describe('sgEdges (Security view)', () => {
  it('draws the reference chain: internet → ALB → app → database, with nothing open to the world on private tiers', async () => {
    const { sgEdges } = await import('../../src/engine/net/sgGraph');
    const ref = ledgerly.reference;
    const name = (id: string) => (id === 'internet' ? 'internet' : ref.components[id].name);
    const edges = sgEdges(ref).map((e) => `${name(e.from)}>${name(e.to)}${e.open ? '!' : ''}`).sort();
    expect(edges).toEqual(['app-asg>ledger-db', 'internet>web-alb', 'web-alb>app-asg'].sort());
  });
  it("flags the whole internet reaching the app tier when it borrows the ALB's group", async () => {
    const { sgEdges } = await import('../../src/engine/net/sgGraph');
    const ref = ledgerly.reference;
    const byName = (n: string) => Object.values(ref.components).find((c) => c.name === n)!;
    const asg = byName('app-asg');
    const r = attachSecurityGroups(ref, asg.id, [...asg.securityGroupIds!, byName('web-alb').securityGroupIds![0]]);
    if (!r.ok) throw new Error(r.error);
    const open = sgEdges(r.board).filter((e) => e.open);
    expect(open.map((e) => r.board.components[e.to].name)).toEqual(['app-asg']);
    expect(open[0].via).toEqual(['alb-sg']);
  });
});
