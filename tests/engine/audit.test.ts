import { describe, expect, it } from 'vitest';
import { attachSecurityGroups } from '../../src/engine/board';
import { AUDIT_RULES } from '../../src/engine/audit/rules';
import { ledgerly } from '../../src/content/missions/ledgerly';

describe('privateTierSgsChained', () => {
  const rule = AUDIT_RULES.privateTierSgsChained;
  const ref = ledgerly.reference;
  const byName = (n: string) => Object.values(ref.components).find((c) => c.name === n)!;

  it('passes the reference design', () => {
    expect(rule.check(ref).status).toBe('pass');
  });

  it("points at the component when the load balancer's SG is attached to the app tier", () => {
    const alb = byName('web-alb');
    const asg = byName('app-asg');
    const r = attachSecurityGroups(ref, asg.id, [...asg.securityGroupIds!, alb.securityGroupIds![0]]);
    if (!r.ok) throw new Error(r.error);
    const f = rule.check(r.board);
    expect(f.status).toBe('fail');
    expect(f.fix?.target).toBe(asg.id);
    expect(f.fix?.focus).toEqual({ tab: 'networking', label: 'Security groups attached' });
    expect(f.fix?.hint).toMatch(/untick alb-sg/);
    expect(f.message).toMatch(/app-asg has the load balancer's security group \(alb-sg\) attached/);
  });

  it("points at the open rule when the tier's own group allows the world, and names the group to use instead", () => {
    const bad = ledgerly.mistakes.find((m) => m.name === 'App security group open to 0.0.0.0/0')!.board;
    const f = rule.check(bad);
    expect(f.status).toBe('fail');
    expect(bad.securityGroups[f.fix!.target!]?.name).toBe('app-sg');
    expect(f.fix?.ruleRef).toMatch(/^inbound rule #\d+$/);
    expect(f.fix?.hint).toMatch(/source alb-sg/);
  });
});

describe('every audit rule', () => {
  it('explains why it exists', () => {
    for (const r of Object.values(AUDIT_RULES)) expect(r.why.length, r.id).toBeGreaterThan(20);
  });
});
