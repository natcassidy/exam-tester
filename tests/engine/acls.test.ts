import { describe, expect, it } from 'vitest';
import type { Nacl, SecurityGroup } from '../../src/engine/model';
import { evaluateNacl, validateNaclRule } from '../../src/engine/net/nacl';
import { evaluateSgs } from '../../src/engine/net/sg';
import { BoardBuilder } from '../../src/engine/builder';
import { validateSgRule } from '../../src/engine/board';
import { ledgerlyLayout } from '../../src/content/missions/ledgerly';

const nacl: Nacl = {
  id: 'acl-1',
  name: 'acl-1',
  vpcId: 'v',
  inbound: [
    { ruleNumber: 200, protocol: 'tcp', portRange: [443, 443], cidr: '0.0.0.0/0', action: 'allow' },
    { ruleNumber: 100, protocol: 'tcp', portRange: [443, 443], cidr: '198.51.100.0/24', action: 'deny' },
  ],
  outbound: [],
};

describe('NACL evaluation', () => {
  it('evaluates the lowest rule number first, regardless of insertion order', () => {
    expect(evaluateNacl(nacl, 'inbound', 'tcp', 443, '198.51.100.7')).toMatchObject({ action: 'deny', ruleNumber: 100 });
    expect(evaluateNacl(nacl, 'inbound', 'tcp', 443, '203.0.113.7')).toMatchObject({ action: 'allow', ruleNumber: 200 });
  });

  it('ends with an implicit deny', () => {
    expect(evaluateNacl(nacl, 'inbound', 'tcp', 22, '203.0.113.7')).toEqual({ action: 'deny', ruleNumber: '*' });
    expect(evaluateNacl(nacl, 'outbound', 'tcp', 49152, '203.0.113.7')).toEqual({ action: 'deny', ruleNumber: '*' });
  });

  it('validates rule numbers like AWS', () => {
    const base = { protocol: 'tcp' as const, portRange: [80, 80] as [number, number], cidr: '0.0.0.0/0', action: 'allow' as const };
    expect(validateNaclRule([], { ...base, ruleNumber: 0 })).toMatch(/1 and 32766/);
    expect(validateNaclRule([], { ...base, ruleNumber: 32767 })).toMatch(/1 and 32766/);
    expect(validateNaclRule(nacl.inbound, { ...base, ruleNumber: 100 })).toMatch(/unique/);
    expect(validateNaclRule([], { ...base, ruleNumber: 110 })).toBeNull();
  });
});

describe('security groups', () => {
  const sgA: SecurityGroup = { id: 'sg-a', name: 'alb-sg', vpcId: 'v', inbound: [], outbound: [] };
  const sgB: SecurityGroup = { id: 'sg-b', name: 'app-sg', vpcId: 'v', inbound: [{ protocol: 'tcp', fromPort: 443, toPort: 443, source: { sg: 'sg-a' } }], outbound: [] };

  it('match SG-referencing rules by membership, not IP', () => {
    expect(evaluateSgs([sgB], 'inbound', 'tcp', 443, { ip: '10.0.0.50', sgIds: ['sg-a'] }).allowed).toBe(true);
    expect(evaluateSgs([sgB], 'inbound', 'tcp', 443, { ip: '10.0.0.50', sgIds: [] }).allowed).toBe(false);
  });

  it('are allow-only: a deny rule is rejected with the AWS lesson', () => {
    const b = new BoardBuilder(ledgerlyLayout).place('alb', 'public-a', { name: 'web-alb' });
    const sg = b.board.securityGroups[b.sgOf('web-alb')];
    expect(validateSgRule(b.board, sg, { protocol: 'tcp', fromPort: 22, toPort: 22, source: { cidr: '0.0.0.0/0' }, action: 'deny' })).toBe(
      'Security groups only support allow rules. To block traffic, use a network ACL.',
    );
  });

  it('reject references to an SG in another VPC', () => {
    const b = new BoardBuilder(ledgerlyLayout).place('alb', 'public-a', { name: 'web-alb' });
    b.board.securityGroups['sg-x'] = { id: 'sg-x', name: 'other', vpcId: 'vpc-other', inbound: [], outbound: [] };
    const sg = b.board.securityGroups[b.sgOf('web-alb')];
    expect(validateSgRule(b.board, sg, { protocol: 'tcp', fromPort: 443, toPort: 443, source: { sg: 'sg-x' } })).toMatch(/different VPC/);
  });
});
