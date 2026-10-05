// Surprise events injected into replayed build missions (Stage 4). Each one checks a concept on
// whatever the player built. engine/mastery/surprise.ts only uses a surprise when the mission's
// reference design passes it.

import type { Mission, ServiceType } from '../engine/model';
import type { SurpriseSpec } from '../engine/mastery/surprise';

const has = (m: Mission, t: ServiceType) => Object.values(m.reference.components).some((c) => c.type === t);
const firstAz = (m: Mission) => m.layout.vpc?.azs[0]?.id;
const peakRps = (m: Mission) => {
  const t = m.events.find((e) => e.kind === 'traffic');
  return t ? Math.max(...(t.params.profile as { rps: number }[]).map((p) => p.rps)) : 200;
};
const audit = (name: string, desc: string, rules: string[]) => ({ name, desc, domain: 'secure' as const, kind: 'audit' as const, params: { rules } });

export const SURPRISES: SurpriseSpec[] = [
  {
    id: 'az-outage',
    concepts: ['static-stability', 'rds-multi-az', 'nat-gateway'],
    make: (m) =>
      firstAz(m) && has(m, 'alb')
        ? { name: 'Surprise: an AZ goes dark', desc: `${firstAz(m)} loses power at peak load. Recover within 5 minutes, losing at most a minute of data.`, domain: 'resilient', kind: 'azOutage', params: { az: firstAz(m), loadRps: peakRps(m), rtoSec: 300, rpoSec: 60, requireOutbound: has(m, 'nat') } }
        : null,
  },
  {
    id: 'ephemeral',
    concepts: ['nacls', 'sg-vs-nacl'],
    make: (m) => (has(m, 'alb') ? { name: 'Surprise: the network team "hardens" the NACLs', desc: 'Someone re-checks that customer HTTPS still gets in and the responses still get out on ephemeral ports.', domain: 'secure', kind: 'reachability', params: { from: 'internet', to: 'alb', port: 443, expect: 'allow' } } : null),
  },
  {
    id: 'db-probe',
    concepts: ['vpc-public-private', 'security-groups'],
    make: (m) => (has(m, 'rds') ? { name: 'Surprise: a scanner probes the database', desc: 'A bot on the internet tries the database port directly.', domain: 'secure', kind: 'reachability', params: { from: 'internet', to: 'rds', port: 3306, expect: 'deny' } } : null),
  },
  {
    id: 'patch',
    concepts: ['nat-gateway', 'internet-gateway'],
    make: (m) => (has(m, 'asg') ? { name: 'Surprise: an urgent security patch', desc: 'Every app server must download a patch over HTTPS right now.', domain: 'secure', kind: 'reachability', params: { from: 'asg', to: 'internet', port: 443, expect: 'allow' } } : null),
  },
  { id: 'ssh', concepts: ['security-groups'], make: () => audit('Surprise: a pen-test report', 'An external tester looks for SSH or RDP open to the world.', ['noSshFromWorld']) },
  { id: 'chaining', concepts: ['sg-chaining'], make: () => audit('Surprise: least-privilege review', 'Security checks that each private tier only accepts traffic from the tier in front of it.', ['privateTierSgsChained', 'dbSgLeastPrivilege']) },
  { id: 'private', concepts: ['vpc-public-private'], make: () => audit('Surprise: network exposure review', 'Are the app servers and databases kept out of public subnets?', ['appTierPrivate', 'dbNotPublic']) },
  { id: 'encryption', concepts: ['encryption-at-rest'], make: () => audit('Surprise: the compliance auditor', 'Every data store must encrypt data at rest.', ['encryptionAtRest']) },
  { id: 'bpa', concepts: ['s3-block-public-access'], make: () => audit('Surprise: a leaked-bucket headline', "After a competitor's leak, the CISO checks every bucket's Block Public Access.", ['s3BlockPublicAccess']) },
  { id: 'waf', concepts: ['aws-waf'], make: () => audit('Surprise: a botnet finds you', 'A credential-stuffing botnet arrives. Is every public entry point behind a WAF?', ['wafOnPublicEntry']) },
  {
    id: 'oops-delete',
    concepts: ['s3-versioning'],
    make: (m) => (has(m, 's3') ? { name: 'Surprise: "I deleted the wrong folder"', desc: 'An engineer runs a recursive delete on the bucket by mistake. Can you get the objects back?', domain: 'resilient', kind: 'dataLoss', params: { scenario: 'accidental-delete', target: 's3', rpoSec: 3600 } } : null),
  },
];
