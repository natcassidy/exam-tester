// Shared pieces for incident missions: a production VPC layout, a healthy three-tier app to
// break, and the events most incidents rerun to prove a fix.

import type { EventSpec, Mission, UsageProfile, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

export const prodLayout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  vpc: {
    id: 'vpc-prod',
    cidr: '10.0.0.0/16',
    igw: true,
    azs: [
      { id: 'us-east-1a', name: 'us-east-1a' },
      { id: 'us-east-1b', name: 'us-east-1b' },
    ],
    routeTables: [
      { id: 'rtb-public', name: 'rtb-public', routes: [{ dest: '0.0.0.0/0', target: { igw: 'igw-1' } }] },
      { id: 'rtb-private-a', name: 'rtb-private-a', routes: [] },
      { id: 'rtb-private-b', name: 'rtb-private-b', routes: [] },
    ],
    subnets: [
      { id: 'public-a', name: 'public-a', cidr: '10.0.0.0/24', az: 'us-east-1a', tier: 'public', routeTableId: 'rtb-public' },
      { id: 'public-b', name: 'public-b', cidr: '10.0.1.0/24', az: 'us-east-1b', tier: 'public', routeTableId: 'rtb-public' },
      { id: 'app-a', name: 'app-a', cidr: '10.0.10.0/24', az: 'us-east-1a', tier: 'app', routeTableId: 'rtb-private-a' },
      { id: 'app-b', name: 'app-b', cidr: '10.0.11.0/24', az: 'us-east-1b', tier: 'app', routeTableId: 'rtb-private-b' },
      { id: 'data-a', name: 'data-a', cidr: '10.0.20.0/24', az: 'us-east-1a', tier: 'data', routeTableId: 'rtb-private-a' },
      { id: 'data-b', name: 'data-b', cidr: '10.0.21.0/24', az: 'us-east-1b', tier: 'data', routeTableId: 'rtb-private-b' },
    ],
  },
};

export const serverlessLayout: VpcLayout = { regionId: 'us-east-1', regionName: 'US East (N. Virginia)' };

export const ACCOUNT = '111122223333';

/** A healthy three-tier app: ALB → ASG (4× t3.medium) → Multi-AZ MySQL, one NAT per AZ. */
export function threeTier(): BoardBuilder {
  return new BoardBuilder(prodLayout, 'helpful')
    .place('alb', 'public-a', { name: 'web-alb' })
    .place('asg', 'app-a', { name: 'app-asg' })
    .config('app-asg', { min: 4, desired: 4, max: 8, healthCheckType: 'ELB', healthCheckGraceSec: 300 })
    .place('rds', 'data-a', { name: 'app-db' })
    .config('app-db', { multiAz: true, storageEncrypted: true })
    .place('nat', 'public-a', { name: 'nat-a' })
    .place('nat', 'public-b', { name: 'nat-b' });
}

export const INCIDENT_USAGE: UsageProfile = { requestsPerMonth: 0, dataOutGb: 0, s3StorageGb: 0, s3GetRequests: 0, s3PutRequests: 0, flows: [] };

export const ev = {
  reach: (requirementIds: string[]): EventSpec => ({ id: 'reach', name: 'Customers reach the app', desc: 'HTTPS from the internet through the load balancer to the app tier and back.', domain: 'resilient', concepts: ['alb', 'alb-error-codes'], kind: 'reachability', params: { from: 'internet', to: 'alb', port: 443, expect: 'allow' }, requirementIds }),
  appDb: (requirementIds: string[]): EventSpec => ({ id: 'app-db', name: 'App queries the database', desc: 'The app tier opens MySQL connections (3306) to the database.', domain: 'secure', concepts: ['sg-chaining', 'security-groups'], kind: 'reachability', params: { from: 'asg', to: 'rds', port: 3306, expect: 'allow' }, requirementIds }),
  dbPrivate: (requirementIds: string[]): EventSpec => ({ id: 'db-private', name: 'Attacker probes the database', desc: 'Someone on the internet tries port 3306.', domain: 'secure', concepts: ['vpc-public-private'], kind: 'reachability', params: { from: 'internet', to: 'rds', port: 3306, expect: 'deny' }, requirementIds }),
  patch: (requirementIds: string[]): EventSpec => ({ id: 'patch', name: 'Patch Tuesday', desc: 'Every app server downloads updates over HTTPS from the internet.', domain: 'secure', concepts: ['nat-gateway', 'route-blackholes'], kind: 'reachability', params: { from: 'asg', to: 'internet', port: 443, expect: 'allow' }, requirementIds }),
  audit: (rules: string[], requirementIds: string[]): EventSpec => ({ id: 'audit', name: 'Security audit', desc: 'The security team re-checks the design after the fix.', domain: 'secure', concepts: ['sg-chaining', 'vpc-public-private'], kind: 'audit', params: { rules }, requirementIds }),
};

/** Fields every incident shares. */
export function incidentBase(): Pick<Mission, 'stage' | 'mode' | 'budget' | 'usage' | 'defaults' | 'mistakes' | 'palette'> {
  return { stage: 2, mode: 'incident', budget: 0, usage: INCIDENT_USAGE, defaults: 'bare', mistakes: [], palette: [] };
}
