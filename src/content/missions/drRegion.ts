import type { Mission, VpcLayout, VpcSpec } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

function threeTier(id: string, name: string, region: string, octet: number, igwId: string): VpcSpec {
  const [a, b] = [`${region}a`, `${region}b`];
  const s = (sid: string, n: number, az: string, tier: string, rt: string) => ({ id: `${sid}`, name: sid, cidr: `10.${octet}.${n}.0/24`, az, tier, routeTableId: rt });
  const p = id === 'vpc-primary' ? '' : 'dr-';
  return {
    id,
    name,
    cidr: `10.${octet}.0.0/16`,
    igw: true,
    azs: [
      { id: a, name: a },
      { id: b, name: b },
    ],
    routeTables: [
      { id: `${p}rtb-public`, name: `${p}rtb-public`, routes: [{ dest: '0.0.0.0/0', target: { igw: igwId } }] },
      { id: `${p}rtb-private`, name: `${p}rtb-private`, routes: [] },
    ],
    subnets: [
      s(`${p}public-a`, 0, a, 'public', `${p}rtb-public`),
      s(`${p}public-b`, 1, b, 'public', `${p}rtb-public`),
      s(`${p}app-a`, 10, a, 'app', `${p}rtb-private`),
      s(`${p}app-b`, 11, b, 'app', `${p}rtb-private`),
      s(`${p}data-a`, 20, a, 'data', `${p}rtb-private`),
      s(`${p}data-b`, 21, b, 'data', `${p}rtb-private`),
    ],
  };
}

const layout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  vpc: threeTier('vpc-primary', 'primary', 'us-east-1', 0, 'igw-1'),
  extraVpcs: [{ regionId: 'us-west-2', regionName: 'US West (Oregon)', vpc: threeTier('vpc-dr', 'dr', 'us-west-2', 1, 'igw-vpc-dr') }],
};

const failoverRecords = (hc: boolean) => [
  { id: 'rec-primary', targetId: 'shop-alb', healthCheck: hc, failover: 'primary' as const },
  { id: 'rec-dr', targetId: 'dr-alb', healthCheck: hc, failover: 'secondary' as const },
];

function base(): BoardBuilder {
  return new BoardBuilder(layout, 'helpful')
    .place('alb', 'public-a', { name: 'shop-alb' })
    .place('asg', 'app-a', { name: 'shop-asg' })
    .config('shop-asg', { min: 2, desired: 2, max: 8, policy: { kind: 'targetTracking', targetCpu: 50 }, warmupSec: 120, healthCheckType: 'ELB' })
    .config('shop-alb', { targetId: 'shop-asg' })
    .place('rds', 'data-a', { name: 'orders-db' })
    .config('orders-db', { multiAz: true, storageEncrypted: true, backupRetentionDays: 7 })
    .place('alb', 'dr-public-a', { name: 'dr-alb' })
    .place('asg', 'dr-app-a', { name: 'dr-asg' })
    .config('dr-asg', { min: 0, desired: 0, max: 8, policy: { kind: 'targetTracking', targetCpu: 50 }, warmupSec: 120, healthCheckType: 'ELB' })
    .config('dr-alb', { targetId: 'dr-asg' });
}

function reference(): BoardBuilder {
  return base()
    .place('rds', 'dr-data-a', { name: 'orders-replica' })
    .config('orders-replica', { replicaOf: 'orders-db', storageEncrypted: true, backupRetentionDays: 7 })
    .place('route53', '', { name: 'shop-dns' })
    .config('shop-dns', { recordName: 'shop.example.com', policy: 'failover', records: failoverRecords(true) });
}

export const drRegion: Mission = {
  id: 'dr-region',
  stage: 3,
  mode: 'build',
  title: 'The Region went dark',
  client: 'Trailhead Outfitters, outdoor gear e-commerce',
  users: '60,000 shoppers a day, 400 rps at peak, all orders in one MySQL database',
  brief:
    "Last spring a bad deploy took our only Region offline for an afternoon and we lost a weekend's worth of sales. The board has approved a disaster recovery plan: if us-east-1 disappears, we must be taking orders from us-west-2 within an hour, and we can lose at most 15 minutes of orders. We already run across two AZs. We don't want to pay for a second full copy of everything that sits idle all year.",
  requirements: [
    { id: 'r1', text: 'Shoppers reach the store over HTTPS' },
    { id: 'r2', text: 'Lose us-east-1: RTO ≤ 1 h, RPO ≤ 15 min', target: { rtoSec: 3600, rpoSec: 900 } },
    { id: 'r3', text: 'Still survive losing a single AZ (RTO ≤ 5 min)', target: { rtoSec: 300, rpoSec: 60 } },
    { id: 'r4', text: 'Databases private and encrypted' },
    { id: 'r5', text: 'Monthly bill under $500', target: { budget: 500 } },
  ],
  budget: 500,
  usage: {
    requestsPerMonth: 200_000_000,
    dataOutGb: 400,
    s3StorageGb: 0,
    s3GetRequests: 0,
    s3PutRequests: 0,
    flows: [],
    crossRegionGb: 150,
  },
  defaults: 'helpful',
  layout,
  palette: ['alb', 'asg', 'rds', 'aurora', 'route53', 'backup', 'nat'],
  events: [
    { id: 'reach', name: 'Shoppers reach the store', desc: 'HTTPS from the internet through Route 53 to the store.', domain: 'resilient', concepts: ['route53-routing-policies', 'alb'], kind: 'reachability', params: { from: 'internet', to: 'route53', port: 443, expect: 'allow', label: { to: 'the store’s DNS name' } }, requirementIds: ['r1'] },
    { id: 'region-outage', name: 'us-east-1 goes dark', desc: 'The whole primary Region becomes unreachable at 400 rps. Route 53 has to move shoppers, the DR database has to take writes and the DR fleet has to carry the load.', domain: 'resilient', concepts: ['dr-strategies', 'rds-cross-region-replicas', 'route53-routing-policies'], kind: 'regionOutage', params: { region: 'us-east-1', loadRps: 400, rtoSec: 3600, rpoSec: 900 }, requirementIds: ['r2'] },
    { id: 'az-outage', name: 'us-east-1a goes dark', desc: 'A single AZ fails in the primary Region at 400 rps.', domain: 'resilient', concepts: ['rds-multi-az', 'static-stability'], kind: 'azOutage', params: { az: 'us-east-1a', loadRps: 400, rtoSec: 300, rpoSec: 60 }, requirementIds: ['r3'] },
    { id: 'audit', name: 'Security audit', desc: 'Every database private and encrypted, no SSH from the world.', domain: 'secure', concepts: ['encryption-at-rest', 'vpc-public-private'], kind: 'audit', params: { rules: ['dbNotPublic', 'noSshFromWorld', 'encryptionAtRest'] }, requirementIds: ['r4'] },
    { id: 'bill', name: 'Monthly bill', desc: 'Both Regions, cross-Region replication traffic and Route 53 health checks.', domain: 'cost', concepts: ['dr-strategies', 'data-transfer-costs'], kind: 'bill', params: {}, requirementIds: ['r5'], passesOnEmptyBoard: true },
  ],
  questions: ['q-dr-1', 'q-dr-2', 'q-dr-3', 'q-dr-4', 'q-dr-5'],
  concepts: ['dr-strategies', 'rds-cross-region-replicas', 'route53-routing-policies', 'aws-backup', 'aurora-global', 'rds-multi-az', 'static-stability'],
  reference: reference().done(),
  mistakes: [
    {
      name: 'Backup and restore (daily snapshot copies, no replica)',
      board: base()
        .place('route53', '', { name: 'shop-dns' })
        .config('shop-dns', { recordName: 'shop.example.com', policy: 'failover', records: failoverRecords(true) })
        .place('backup', 'us-east-1', { name: 'nightly-backup' })
        .config('nightly-backup', { resourceIds: ['orders-db'], frequencyHours: 24, retentionDays: 35, copyRegion: 'us-west-2' })
        .done(),
      expectFail: ['region-outage'],
    },
    { name: 'Simple routing to the primary load balancer', board: reference().config('shop-dns', { policy: 'simple', aliasTargetId: 'shop-alb' }).done(), expectFail: ['region-outage'] },
    { name: 'Failover records without health checks', board: reference().config('shop-dns', { records: failoverRecords(false) }).done(), expectFail: ['region-outage'] },
    { name: 'Read replica in the same Region', board: base().place('rds', 'data-b', { name: 'orders-replica' }).config('orders-replica', { replicaOf: 'orders-db', storageEncrypted: true }).place('route53', '', { name: 'shop-dns' }).config('shop-dns', { recordName: 'shop.example.com', policy: 'failover', records: failoverRecords(true) }).done(), expectFail: ['region-outage'] },
    {
      name: 'Multi-site active/active (full fleet in both Regions)',
      board: reference()
        .config('dr-asg', { min: 2, desired: 2 })
        .config('shop-asg', { min: 4, desired: 4 })
        .config('dr-asg', { min: 4, desired: 4 })
        .config('shop-dns', { policy: 'latency', records: [{ id: 'rec-primary', targetId: 'shop-alb', healthCheck: true }, { id: 'rec-dr', targetId: 'dr-alb', healthCheck: true }] })
        .done(),
      expectFail: ['bill'],
    },
  ],
  keywords: ['RTO / RPO', 'pilot light', 'warm standby', 'cross-Region read replica', 'Route 53 failover routing', 'most cost-effective DR'],
  hints: ['A cross-Region read replica of the database in us-west-2', 'A DR fleet that can scale out (it may start at zero)', 'Route 53 failover routing with health checks'],
};
