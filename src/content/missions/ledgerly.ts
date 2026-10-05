import type { Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

export const ledgerlyLayout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  vpc: {
    id: 'vpc-ledgerly',
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

const layout = ledgerlyLayout;

function reference(): BoardBuilder {
  return new BoardBuilder(layout, 'helpful')
    .place('alb', 'public-a', { name: 'web-alb' })
    .place('asg', 'app-a', { name: 'app-asg' })
    .config('app-asg', { min: 4, desired: 4, max: 20, policy: { kind: 'targetTracking', targetCpu: 50 }, warmupSec: 180, healthCheckType: 'ELB' })
    .place('rds', 'data-a', { name: 'ledger-db' })
    .config('ledger-db', { multiAz: true, storageEncrypted: true, backupRetentionDays: 7 })
    .place('nat', 'public-a', { name: 'nat-a' })
    .place('nat', 'public-b', { name: 'nat-b' })
    .place('waf', '', { name: 'web-acl' })
    .config('web-acl', { associatedId: 'web-alb' });
}

export const ledgerly: Mission = {
  id: 'ledgerly',
  stage: 1,
  mode: 'build',
  title: 'The six-hour outage',
  client: 'Ledgerly, accounting SaaS',
  users: '4,000 small businesses; traffic spikes 8× at month-end close',
  brief:
    "Last quarter our single server in one data centre died during month-end close. We were down six hours and lost an afternoon of invoices. Customers nearly left. We're moving to AWS and it can never happen again: if a whole data centre goes, we need to be back within five minutes and lose at most a minute of data. The database holds financial records, so it must never be reachable from the internet. Servers still need to download security patches.",
  requirements: [
    { id: 'r1', text: 'Customers reach the app over HTTPS' },
    { id: 'r2', text: 'The database is never reachable from the internet' },
    { id: 'r3', text: 'App servers can download patches (outbound internet)' },
    { id: 'r4', text: 'Month-end close: ≤ 0.5% errors and p95 ≤ 800 ms', target: { p95Ms: 800 } },
    { id: 'r5', text: 'Lose an AZ: RTO ≤ 5 min, RPO ≤ 1 min', target: { rtoSec: 300, rpoSec: 60 } },
    { id: 'r6', text: 'Passes the security audit (WAF, private tiers, SG chaining, encryption)' },
    { id: 'r7', text: 'Stay under $1,100/month', target: { budget: 1100 } },
  ],
  budget: 1100,
  usage: {
    requestsPerMonth: 400_000_000,
    dataOutGb: 500,
    s3StorageGb: 0,
    s3GetRequests: 0,
    s3PutRequests: 0,
    flows: [{ from: 'asg', to: 'internet', gbPerMonth: 100 }],
  },
  defaults: 'helpful',
  layout,
  palette: ['alb', 'asg', 'ec2', 'rds', 'nat', 'waf', 'route53'],
  events: [
    { id: 'reach', name: 'Customers reach the app', desc: 'HTTPS from the internet to the load balancer and on to the app tier.', domain: 'resilient', concepts: ['alb', 'security-groups', 'alb-health-checks'], kind: 'reachability', params: { from: 'internet', to: 'alb', port: 443, expect: 'allow', label: { to: 'a load balancer' } }, requirementIds: ['r1'] },
    { id: 'app-db', name: 'App queries the database', desc: 'The app tier opens MySQL connections (3306) to the database.', domain: 'secure', concepts: ['sg-chaining', 'security-groups'], kind: 'reachability', params: { from: 'asg', to: 'rds', port: 3306, expect: 'allow', label: { from: 'an app tier (Auto Scaling group)', to: 'a database' } }, requirementIds: ['r2'] },
    { id: 'db-private', name: 'Attacker probes the database', desc: 'Someone on the internet tries port 3306 on the database.', domain: 'secure', concepts: ['vpc-public-private', 'security-groups'], kind: 'reachability', params: { from: 'internet', to: 'rds', port: 3306, expect: 'deny', label: { to: 'a database' } }, requirementIds: ['r2'] },
    { id: 'patch', name: 'Patch Tuesday', desc: 'Every app server downloads updates over HTTPS from the internet.', domain: 'secure', concepts: ['nat-gateway', 'vpc-public-private'], kind: 'reachability', params: { from: 'asg', to: 'internet', port: 443, expect: 'allow', label: { from: 'an app tier (Auto Scaling group)' } }, requirementIds: ['r3'] },
    {
      id: 'month-end',
      name: 'Month-end close',
      desc: 'Traffic climbs from 300 to 2,400 rps over 30 minutes and holds for half an hour.',
      domain: 'performant',
      concepts: ['asg-scaling', 'static-stability'],
      kind: 'traffic',
      params: {
        entry: 'alb',
        profile: [{ min: 0, rps: 300 }, { min: 10, rps: 300 }, { min: 40, rps: 2400 }, { min: 70, rps: 2400 }, { min: 80, rps: 600 }],
        durationMin: 90,
        slo: { errorRate: 0.005, p95Ms: 800 },
        baseLatencyMs: 60,
        db: { queriesPerRequest: 0.6, readFraction: 0.8 },
      },
      requirementIds: ['r4'],
    },
    { id: 'az-outage', name: 'us-east-1a goes dark', desc: 'A power event takes out us-east-1a at 400 rps.', domain: 'resilient', concepts: ['rds-multi-az', 'static-stability', 'nat-gateway', 'alb-health-checks'], kind: 'azOutage', params: { az: 'us-east-1a', loadRps: 400, rtoSec: 300, rpoSec: 60, requireOutbound: true }, requirementIds: ['r5'] },
    { id: 'audit', name: 'Security audit', desc: 'An auditor reviews the design before go-live.', domain: 'secure', concepts: ['aws-waf', 'sg-chaining', 'vpc-public-private', 'encryption-at-rest'], kind: 'audit', params: { rules: ['dbNotPublic', 'noSshFromWorld', 'appTierPrivate', 'privateTierSgsChained', 'wafOnPublicEntry', 'encryptionAtRest'] }, requirementIds: ['r2', 'r6'] },
    { id: 'bill', name: 'Monthly bill', desc: '400M requests, 500 GB out, 100 GB of patch downloads.', domain: 'cost', concepts: ['nat-data-processing', 'data-transfer-costs'], kind: 'bill', params: {}, requirementIds: ['r7'], passesOnEmptyBoard: true },
  ],
  questions: ['q-lg-1', 'q-lg-2', 'q-lg-3', 'q-lg-4', 'q-lg-5'],
  concepts: ['alb', 'alb-health-checks', 'asg-scaling', 'static-stability', 'rds-multi-az', 'rds-backups', 'nat-gateway', 'security-groups', 'sg-chaining', 'vpc-public-private', 'aws-waf', 'encryption-at-rest', 'nacls', 'internet-gateway'],
  reference: reference().done(),
  mistakes: [
    {
      name: 'Database publicly accessible',
      board: reference()
        .subnets('ledger-db', ['public-a', 'public-b'])
        .config('ledger-db', { publiclyAccessible: true })
        .sgRule('ledger-db', 'inbound', { protocol: 'tcp', fromPort: 3306, toPort: 3306, source: { cidr: '0.0.0.0/0' } })
        .done(),
      expectFail: ['db-private', 'audit'],
    },
    { name: 'Auto Scaling group in one AZ only', board: reference().subnets('app-asg', ['app-a']).done(), expectFail: ['az-outage'] },
    { name: 'Single NAT gateway for both AZs', board: reference().remove('nat-b').route('rtb-private-b', '0.0.0.0/0', { natName: 'nat-a' }).done(), expectFail: ['az-outage'] },
    { name: 'App security group open to 0.0.0.0/0', board: reference().sgRule('app-asg', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } }).done(), expectFail: ['audit'] },
    { name: 'Max capacity too low for the surge', board: reference().config('app-asg', { max: 6 }).done(), expectFail: ['month-end'] },
    { name: 'Single-AZ database', board: reference().config('ledger-db', { multiAz: false }).done(), expectFail: ['az-outage'] },
  ],
  keywords: ['highly available', 'fault tolerant', 'RTO / RPO', 'Multi-AZ', 'must not be accessible from the internet', 'least privilege'],
  hints: ['Load balancer across two AZs', 'App tier in an Auto Scaling group in private subnets', 'Multi-AZ database in the data subnets', 'One NAT gateway per AZ', 'A WAF web ACL on the load balancer'],
};
