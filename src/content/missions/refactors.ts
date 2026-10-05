// Stage 4 refactor missions: start from a working but expensive or fragile board, apply a
// requirement change, and meet every requirement at the lowest cost.

import type { Mission, UsageProfile, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import type { CommitmentParams } from '../../engine/sim/events/commitment';
import type { StorageLifecycleParams } from '../../engine/sim/events/storageLifecycle';

const twoAz = (id: string, cidr16: string, tiers: string[]): VpcLayout => {
  const [a, b] = cidr16.split('.');
  const subnets = [
    { id: 'public-a', name: 'public-a', cidr: `${a}.${b}.0.0/24`, az: 'us-east-1a', tier: 'public', routeTableId: 'rtb-public' },
    { id: 'public-b', name: 'public-b', cidr: `${a}.${b}.1.0/24`, az: 'us-east-1b', tier: 'public', routeTableId: 'rtb-public' },
    ...tiers.flatMap((t, i) => [
      { id: `${t}-a`, name: `${t}-a`, cidr: `${a}.${b}.${10 * (i + 1)}.0/24`, az: 'us-east-1a', tier: t, routeTableId: 'rtb-private-a' },
      { id: `${t}-b`, name: `${t}-b`, cidr: `${a}.${b}.${10 * (i + 1) + 1}.0/24`, az: 'us-east-1b', tier: t, routeTableId: 'rtb-private-b' },
    ]),
  ];
  return {
    regionId: 'us-east-1',
    regionName: 'US East (N. Virginia)',
    vpc: {
      id,
      cidr: `${a}.${b}.0.0/16`,
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
      subnets,
    },
  };
};

const usage0: UsageProfile = { requestsPerMonth: 0, dataOutGb: 0, s3StorageGb: 0, s3GetRequests: 0, s3PutRequests: 0, flows: [] };

// =====================================================================================
// 1. The always-on batch: Spot with an On-Demand base, diversified, capacity-aware.
// =====================================================================================

const batchLayout = twoAz('vpc-render', '10.30.0.0', ['work']);

function renderFarm(): BoardBuilder {
  return new BoardBuilder(batchLayout, 'helpful')
    .place('asg', 'work-a', { name: 'render-fleet' })
    .config('render-fleet', { instanceType: 'm5.large', min: 12, desired: 12, max: 12, policy: { kind: 'none' } })
    .place('s3', '', { name: 'frames' })
    .place('vpce', 'vpc-render', { name: 's3-endpoint' })
    .config('s3-endpoint', { routeTableIds: ['rtb-private-a', 'rtb-private-b'] });
}
const spot = (onDemandBase: number, spotPercent: number, allocation: 'lowest-price' | 'capacity-optimized' | 'price-capacity-optimized', extraTypes: string[] = []) => ({ purchase: { onDemandBase, spotPercent, allocation, extraTypes } });
const spotRef = () => renderFarm().config('render-fleet', spot(2, 100, 'price-capacity-optimized', ['m5a.large', 'm6i.large']));

export const spotBatch: Mission = {
  id: 'rf-spot',
  stage: 4,
  mode: 'refactor',
  title: 'The always-on batch',
  client: 'Pixelmill, an animation studio',
  users: 'A render queue that never empties: 12 workers, all night, every night',
  brief:
    "Our render farm is twelve m5.large workers running around the clock, all On-Demand. Every frame is checkpointed, so a worker can disappear and another one picks the frame up again. The new finance director has seen the bill.",
  requirements: [
    { id: 'r1', text: 'At least 10 workers rendering at all times, even when Spot capacity gets tight' },
    { id: 'r2', text: 'Compute under $450/month (it is about $850 today)', target: { budget: 450 } },
  ],
  refactor: { change: 'Finance: "Cut the render farm bill roughly in half by next month. The render deadline doesn\'t move."' },
  budget: 450,
  usage: { ...usage0, s3StorageGb: 500, s3GetRequests: 2_000_000, s3PutRequests: 500_000 },
  defaults: 'helpful',
  layout: batchLayout,
  palette: ['asg', 's3', 'vpce', 'savings'],
  startingBoard: renderFarm().done(),
  events: [
    { id: 'crunch', name: 'Spot capacity crunch', desc: 'A big launch elsewhere in us-east-1 drains the cheapest instance pools for an hour. EC2 reclaims Spot capacity there with a two-minute warning.', domain: 'resilient', concepts: ['ec2-spot'], kind: 'spotReclaim', params: { target: 'asg', requiredInstances: 10, crunchMin: 60 }, requirementIds: ['r1'] },
    { id: 'bill', name: 'Monthly bill', desc: 'Twelve workers, 730 hours a month, plus the frame bucket.', domain: 'cost', concepts: ['ec2-spot', 'ec2-purchase-options'], kind: 'bill', params: {}, requirementIds: ['r2'], passesOnEmptyBoard: true },
  ],
  questions: ['q-rf-spot-1', 'q-rf-spot-2', 'q-rf-spot-3', 'q-rf-spot-4'],
  concepts: ['ec2-spot', 'ec2-purchase-options', 'asg-scaling'],
  reference: spotRef().done(),
  mistakes: [
    { name: 'All Spot, lowest price, one instance type', board: renderFarm().config('render-fleet', spot(0, 100, 'lowest-price')).done(), expectFail: ['crunch'] },
    { name: 'Capacity-optimized, but only m5.large allowed', board: renderFarm().config('render-fleet', spot(2, 100, 'capacity-optimized')).done(), expectFail: ['crunch'] },
    { name: 'Three instance types, lowest-price allocation', board: renderFarm().config('render-fleet', spot(2, 100, 'lowest-price', ['m5a.large', 'm6i.large'])).done(), expectFail: ['crunch'] },
    { name: 'Half On-Demand, half Spot', board: renderFarm().config('render-fleet', spot(6, 100, 'price-capacity-optimized', ['m5a.large', 'm6i.large'])).done(), expectFail: ['bill'] },
    { name: 'Shrink to six On-Demand workers', board: renderFarm().config('render-fleet', { min: 6, desired: 6, max: 6 }).done(), expectFail: ['crunch'] },
  ],
  keywords: ['interruptible / checkpointed / fault-tolerant → Spot', 'must always run → On-Demand base or commitment', 'diversify instance types and AZs', 'capacity-optimized / price-capacity-optimized allocation'],
  hints: ['Keep an On-Demand base for the capacity you can never lose', 'Spot above the base', 'More instance types = more Spot pools', 'An allocation strategy that avoids the contested pools'],
};

// =====================================================================================
// 2. Steady state: commit to the baseline with the right kind of commitment.
// =====================================================================================

const analyticsLayout = twoAz('vpc-analytics', '10.31.0.0', ['app']);
function analytics(): BoardBuilder {
  return new BoardBuilder(analyticsLayout, 'helpful')
    .place('asg', 'app-a', { name: 'analytics-fleet' })
    .config('analytics-fleet', { instanceType: 'm5.large', min: 8, desired: 8, max: 8, policy: { kind: 'none' } });
}
const commitPlan: CommitmentParams['plan'] = [
  { fromMonth: 0, toMonth: 6, label: '8 × m5.large', ec2: [{ instanceType: 'm5.large', count: 8 }], lambdaOdHourly: 0 },
  { fromMonth: 6, toMonth: 12, label: '4 × m5.large + ingestion on Lambda', ec2: [{ instanceType: 'm5.large', count: 4 }], lambdaOdHourly: 0.3 },
  { fromMonth: 12, toMonth: 36, label: '4 × c5.large + ingestion on Lambda', ec2: [{ instanceType: 'c5.large', count: 4 }], lambdaOdHourly: 0.3 },
];
const commit = (b: BoardBuilder, cfg: Record<string, unknown>) => b.place('savings', '', { name: 'commitment' }).config('commitment', cfg);

export const steadyState: Mission = {
  id: 'rf-commit',
  stage: 4,
  mode: 'refactor',
  title: 'Steady state',
  client: 'Tallyhawk, a retail analytics company',
  users: 'Dashboards for 300 stores, computed 24/7 by the same fleet for three years now',
  brief:
    "Our analytics fleet has run eight m5.large instances On-Demand, 24/7, for three years, and it will for three more. The roadmap: in month 7 we move ingestion to Lambda and halve the fleet; in month 13 the remaining four move to c5.large after profiling. We pay the On-Demand price for all of it today.",
  requirements: [
    { id: 'r1', text: 'Over the next 3 years, at least 30% cheaper than On-Demand' },
    { id: 'r2', text: 'No more than 5% of any commitment left unused as the roadmap happens' },
  ],
  refactor: { change: 'The CFO: "We know this load will be here for three years. Stop paying list price for it, and don\'t lock us into anything the roadmap breaks."', costEvents: ['savings'] },
  budget: 0,
  usage: usage0,
  defaults: 'helpful',
  layout: analyticsLayout,
  palette: ['savings', 'asg'],
  startingBoard: analytics().done(),
  events: [
    { id: 'savings', name: 'Three-year bill', desc: 'The fleet follows the roadmap for 36 months: 8 m5 → 4 m5 + Lambda → 4 c5 + Lambda.', domain: 'cost', concepts: ['ec2-purchase-options'], kind: 'commitment', params: { check: 'savings', plan: commitPlan, minSavingsPct: 30 } satisfies CommitmentParams, requirementIds: ['r1'] },
    { id: 'stranded', name: 'The roadmap happens', desc: 'Month 7: ingestion moves to Lambda. Month 13: the fleet moves to c5.large. Is any commitment left paying for nothing?', domain: 'cost', concepts: ['ec2-purchase-options'], kind: 'commitment', params: { check: 'stranded', plan: commitPlan, maxWastePct: 5 } satisfies CommitmentParams, requirementIds: ['r2'] },
  ],
  questions: ['q-rf-sp-1', 'q-rf-sp-2', 'q-rf-sp-3', 'q-rf-sp-4'],
  concepts: ['ec2-purchase-options', 'ecs-fargate'],
  reference: commit(analytics(), { plan: 'compute-sp', termYears: 3, hourlyCommit: 0.38 }).done(),
  mistakes: [
    { name: 'EC2 Instance Savings Plan for the m5 family', board: commit(analytics(), { plan: 'ec2-instance-sp', termYears: 3, hourlyCommit: 0.165, instanceType: 'm5.large' }).done(), expectFail: ['savings', 'stranded'] },
    { name: 'Standard RIs for all eight m5.large', board: commit(analytics(), { plan: 'standard-ri', termYears: 3, instanceType: 'm5.large', count: 8 }).done(), expectFail: ['savings', 'stranded'] },
    { name: 'Compute Savings Plan, 1-year term', board: commit(analytics(), { plan: 'compute-sp', termYears: 1, hourlyCommit: 0.54 }).done(), expectFail: ['savings'] },
    { name: 'Convertible RIs for four m5.large', board: commit(analytics(), { plan: 'convertible-ri', termYears: 3, instanceType: 'm5.large', count: 4 }).done(), expectFail: ['savings'] },
    { name: "Compute Savings Plan sized to today's fleet", board: commit(analytics(), { plan: 'compute-sp', termYears: 3, hourlyCommit: 0.5 }).done(), expectFail: ['savings', 'stranded'] },
  ],
  keywords: ['steady state / predictable / 24/7 for years → commit', 'change instance family, Region, or move to Lambda/Fargate → Compute Savings Plan', 'commit to the baseline, not the peak', '3-year term = bigger discount'],
  hints: ['A commitment, not fewer instances', 'One that follows the workload to c5 and to Lambda', 'Sized to the smallest usage the roadmap guarantees', 'For the whole three years'],
};

// =====================================================================================
// 3. Right-size the database.
// =====================================================================================

const dbLayout = twoAz('vpc-shop', '10.32.0.0', ['app', 'data']);
function shop(): BoardBuilder {
  return new BoardBuilder(dbLayout, 'helpful')
    .place('alb', 'public-a', { name: 'shop-alb' })
    .place('asg', 'app-a', { name: 'shop-asg' })
    .config('shop-asg', { min: 4, desired: 4, max: 8, healthCheckType: 'ELB', healthCheckGraceSec: 300, policy: { kind: 'targetTracking', targetCpu: 50 } })
    .place('nat', 'public-a', { name: 'nat-a' })
    .place('nat', 'public-b', { name: 'nat-b' });
}
const rds = (cfg: Record<string, unknown>) => shop().place('rds', 'data-a', { name: 'shop-db' }).config('shop-db', { storageEncrypted: true, backupRetentionDays: 7, ...cfg });
const rush = [
  { min: 0, rps: 150 },
  { min: 10, rps: 150 },
  { min: 15, rps: 500 },
  { min: 45, rps: 500 },
  { min: 55, rps: 200 },
];

export const rightSizeDb: Mission = {
  id: 'rf-db',
  stage: 4,
  mode: 'refactor',
  title: 'Right-size the database',
  client: 'Hearth & Loom, a homeware shop',
  users: 'A busy lunchtime, then quiet; the database has never gone above 15% CPU',
  brief:
    "When we launched, a consultant put our MySQL database on a db.r5.xlarge Multi-AZ \"to be safe\". CloudWatch says it idles at 8% CPU and peaks at 15% in the lunchtime rush, when 80% of queries are reads. The database is now two-thirds of our AWS bill. We still need the lunchtime rush to be fast and to survive losing a data centre.",
  requirements: [
    { id: 'r1', text: 'Lunchtime rush: ≤ 0.5% errors and p95 ≤ 800 ms', target: { p95Ms: 800 } },
    { id: 'r2', text: 'Lose an AZ: back within 5 minutes, at most 1 minute of data lost', target: { rtoSec: 300, rpoSec: 60 } },
    { id: 'r3', text: 'The whole stack under $450/month (about $1,000 today)', target: { budget: 450 } },
  ],
  refactor: { change: 'The owners: "Our database costs more than our rent. Make it cost what it should, without making lunchtime slow or risky."' },
  budget: 450,
  usage: { ...usage0, requestsPerMonth: 30_000_000, dataOutGb: 150, rdsStorageGb: 100, dbAvgQps: 500 },
  defaults: 'helpful',
  layout: dbLayout,
  palette: ['rds', 'aurora', 'asg', 'alb', 'nat'],
  startingBoard: rds({ instanceClass: 'db.r5.xlarge', multiAz: true }).done(),
  events: [
    { id: 'rush', name: 'Lunchtime rush', desc: 'Traffic jumps from 150 to 500 requests/s for half an hour. Each request runs 5 queries, 80% of them reads.', domain: 'performant', concepts: ['db-right-sizing', 'rds-read-replicas'], kind: 'traffic', params: { entry: 'alb', profile: rush, durationMin: 60, slo: { errorRate: 0.005, p95Ms: 800 }, db: { queriesPerRequest: 5, readFraction: 0.8 } }, requirementIds: ['r1'] },
    { id: 'az-outage', name: 'us-east-1a goes dark', desc: 'An AZ fails during the rush, with the primary database in it.', domain: 'resilient', concepts: ['rds-multi-az', 'aurora'], kind: 'azOutage', params: { az: 'us-east-1a', loadRps: 500, rtoSec: 300, rpoSec: 60, requireOutbound: true }, requirementIds: ['r2'] },
    { id: 'bill', name: 'Monthly bill', desc: '30M requests a month on the whole stack.', domain: 'cost', concepts: ['db-right-sizing'], kind: 'bill', params: {}, requirementIds: ['r3'], passesOnEmptyBoard: true },
  ],
  questions: ['q-rf-db-1', 'q-rf-db-2', 'q-rf-db-3', 'q-rf-db-4'],
  concepts: ['db-right-sizing', 'rds-read-replicas', 'rds-multi-az', 'aurora', 'elasticache'],
  reference: rds({ instanceClass: 'db.t3.medium', multiAz: true, readReplicas: 1 }).done(),
  mistakes: [
    { name: 'Small Single-AZ primary with a read replica', board: rds({ instanceClass: 'db.t3.medium', multiAz: false, readReplicas: 1 }).done(), expectFail: ['az-outage'] },
    { name: 'Small Multi-AZ primary, no read replica', board: rds({ instanceClass: 'db.t3.medium', multiAz: true }).done(), expectFail: ['rush'] },
    { name: 'Tiny primary with two read replicas', board: rds({ instanceClass: 'db.t3.micro', multiAz: true, readReplicas: 2 }).done(), expectFail: ['rush'] },
    { name: 'Keep the r5.xlarge, drop Multi-AZ', board: rds({ instanceClass: 'db.r5.xlarge', multiAz: false }).done(), expectFail: ['az-outage', 'bill'] },
    { name: 'One size down: db.r5.large Multi-AZ', board: rds({ instanceClass: 'db.r5.large', multiAz: true }).done(), expectFail: ['bill'] },
  ],
  keywords: ['low CPU, high bill → right-size', 'read-heavy → read replicas / reader endpoint, not a bigger primary', 'Multi-AZ = availability, not capacity', 'spiky or unknown load → Aurora Serverless v2'],
  hints: ['A much smaller primary', 'Somewhere else for the reads', 'Keep automatic failover'],
};

/** Also passes every requirement: Aurora Serverless v2 with one reader. Used by tests. */
export const rightSizeDbAurora = shop()
  .place('aurora', 'data-a', { name: 'shop-aurora' })
  .config('shop-aurora', { serverlessV2: true, minAcu: 0.5, maxAcu: 8, readers: 1 })
  .done();

// =====================================================================================
// 4. Cold data, hot bill.
// =====================================================================================

const regionLayout: VpcLayout = { regionId: 'us-east-1', regionName: 'US East (N. Virginia)' };
const media: Omit<StorageLifecycleParams, 'check'> = {
  target: '"media"',
  monthlyNewGb: 5000,
  avgObjectMb: 4,
  retentionDays: 730,
  reads: [
    { fromDay: 0, toDay: 30, pctPerMonth: 60 },
    { fromDay: 30, toDay: 730, pctPerMonth: 15 },
  ],
  retrieval: [{ fromDay: 0, toDay: 730, maxSec: 1, label: 'A user opens an old photo' }],
  budget: 1300,
};
const exportsWl: Omit<StorageLifecycleParams, 'check'> = {
  target: '"exports"',
  monthlyNewGb: 3000,
  avgObjectMb: 20,
  retentionDays: 14,
  reads: [{ fromDay: 0, toDay: 14, pctPerMonth: 100 }],
  retrieval: [{ fromDay: 0, toDay: 14, maxSec: 1, label: 'A customer downloads an export' }],
  budget: 40,
};
function buckets(mediaCfg: Record<string, unknown>, exportsCfg: Record<string, unknown>): BoardBuilder {
  return new BoardBuilder(regionLayout, 'helpful')
    .place('s3', 'us-east-1', { name: 'media' })
    .config('media', { versioning: false, storageClass: 'STANDARD', ...mediaCfg })
    .place('s3', 'us-east-1', { name: 'exports' })
    .config('exports', { storageClass: 'STANDARD', ...exportsCfg });
}

export const coldData: Mission = {
  id: 'rf-s3',
  stage: 4,
  mode: 'refactor',
  title: 'Cold data, hot bill',
  client: 'Snapfolio, a photo-sharing app',
  users: '5 TB of new photos a month; old albums go viral again without warning',
  brief:
    "Every photo ever uploaded sits in S3 Standard, plus the zip exports customers download once and forget. Photos are opened a lot in their first month; after that, any album can suddenly be shared again and must open instantly when it is. Exports are downloaded in the first day or two. Legal just changed our retention policy.",
  requirements: [
    { id: 'r1', text: 'Every photo opens in milliseconds, whatever its age' },
    { id: 'r2', text: 'Photos are deleted after 2 years; exports after 14 days (and not before)' },
    { id: 'r3', text: 'Photo storage under $1,300/month at steady state' },
    { id: 'r4', text: 'Export storage under $40/month at steady state' },
  ],
  refactor: { change: 'Legal: "Delete photos after two years and exports after fourteen days." Finance: "And the storage bill must come down."', costEvents: ['media-cost', 'exports-cost'] },
  budget: 1340,
  usage: { ...usage0, s3StorageGb: 0 },
  defaults: 'helpful',
  layout: regionLayout,
  palette: ['s3'],
  startingBoard: buckets({}, {}).done(),
  events: [
    { id: 'media-retrieval', name: 'An old album goes viral', desc: 'Photos of every age are opened; each must load in milliseconds.', domain: 'performant', concepts: ['s3-storage-classes', 's3-intelligent-tiering'], kind: 'storageLifecycle', params: { check: 'retrieval', ...media }, requirementIds: ['r1'] },
    { id: 'media-retention', name: 'Photo retention audit', desc: 'Legal checks photos are deleted two years after upload.', domain: 'secure', concepts: ['s3-lifecycle'], kind: 'storageLifecycle', params: { check: 'retention', ...media }, requirementIds: ['r2'] },
    { id: 'exports-retention', name: 'Export retention audit', desc: 'Legal checks exports are deleted after 14 days.', domain: 'secure', concepts: ['s3-lifecycle'], kind: 'storageLifecycle', params: { check: 'retention', ...exportsWl }, requirementIds: ['r2'] },
    { id: 'media-cost', name: 'Photo storage bill', desc: '5 TB a month for two years: 60% read in the first month, then an unpredictable 15% a month.', domain: 'cost', concepts: ['s3-intelligent-tiering', 's3-storage-classes'], kind: 'storageLifecycle', params: { check: 'cost', ...media }, requirementIds: ['r3'] },
    { id: 'exports-cost', name: 'Export storage bill', desc: '3 TB of exports a month, each downloaded once, kept 14 days.', domain: 'cost', concepts: ['s3-storage-classes', 's3-lifecycle'], kind: 'storageLifecycle', params: { check: 'cost', ...exportsWl }, requirementIds: ['r4'] },
  ],
  questions: ['q-rf-s3-1', 'q-rf-s3-2', 'q-rf-s3-3', 'q-rf-s3-4'],
  concepts: ['s3-intelligent-tiering', 's3-storage-classes', 's3-lifecycle'],
  reference: buckets({ storageClass: 'INTELLIGENT_TIERING', expireAfterDays: 730 }, { expireAfterDays: 14 }).done(),
  mistakes: [
    { name: 'Photos to Glacier Flexible Retrieval after 90 days', board: buckets({ lifecycle: [{ afterDays: 90, toClass: 'GLACIER' }], expireAfterDays: 730 }, { expireAfterDays: 14 }).done(), expectFail: ['media-retrieval'] },
    { name: 'Photos to Standard-IA after 30 days', board: buckets({ lifecycle: [{ afterDays: 30, toClass: 'STANDARD_IA' }], expireAfterDays: 730 }, { expireAfterDays: 14 }).done(), expectFail: ['media-cost'] },
    { name: 'Exports uploaded straight to Standard-IA', board: buckets({ storageClass: 'INTELLIGENT_TIERING', expireAfterDays: 730 }, { storageClass: 'STANDARD_IA', expireAfterDays: 14 }).done(), expectFail: ['exports-cost'] },
    { name: 'Intelligent-Tiering, but photos kept forever', board: buckets({ storageClass: 'INTELLIGENT_TIERING' }, { expireAfterDays: 14 }).done(), expectFail: ['media-retention'] },
    { name: 'Exports deleted after 7 days', board: buckets({ storageClass: 'INTELLIGENT_TIERING', expireAfterDays: 730 }, { expireAfterDays: 7 }).done(), expectFail: ['exports-retention'] },
  ],
  keywords: ['unknown / changing access patterns → Intelligent-Tiering', 'must be readable in milliseconds → no Glacier Flexible / Deep Archive', 'short-lived objects → stay in Standard (IA has a 30-day minimum)', 'retention policy → lifecycle expiration'],
  hints: ['A class that follows unpredictable access by itself', 'Expiration rules for both buckets', 'Nothing with a minimum duration longer than the object lives'],
};

// =====================================================================================
// 5. Chatty across AZs.
// =====================================================================================

const azLayout = twoAz('vpc-feed', '10.33.0.0', ['app', 'data']);
function feed(): BoardBuilder {
  return new BoardBuilder(azLayout, 'helpful')
    .place('alb', 'public-a', { name: 'feed-alb' })
    .place('asg', 'app-a', { name: 'feed-asg' })
    .config('feed-asg', { instanceType: 'm5.large', min: 4, desired: 4, max: 8, healthCheckType: 'ELB', healthCheckGraceSec: 300 })
    .place('rds', 'data-a', { name: 'feed-db' })
    .config('feed-db', { multiAz: true, storageEncrypted: true })
    .place('s3', '', { name: 'media-lake' })
    .place('nat', 'public-a', { name: 'nat-a' });
}
const oneNat = () => feed().route('rtb-private-b', '0.0.0.0/0', { natName: 'nat-a' });
const natPerAz = () => feed().place('nat', 'public-b', { name: 'nat-b' });
const endpoint = (b: BoardBuilder, rts: string[]) => b.place('vpce', 'vpc-feed', { name: 's3-endpoint' }).config('s3-endpoint', { routeTableIds: rts });

export const chattyAz: Mission = {
  id: 'rf-az',
  stage: 4,
  mode: 'refactor',
  title: 'Chatty across AZs',
  client: 'Murmur, a news-feed app',
  users: 'App servers pull 20 TB of media a month from S3 to build feeds',
  brief:
    "To save money we put a single NAT gateway in us-east-1a and pointed both private subnets at it. The bill went up, not down: 'NAT gateway' and 'data transfer' are now our two biggest lines. Then the SRE review flagged that if us-east-1a goes, so does everything's internet access. Our app servers still call a payments API on the internet.",
  requirements: [
    { id: 'r1', text: 'Customers reach the feed over HTTPS' },
    { id: 'r2', text: 'App servers reach the payments API on the internet' },
    { id: 'r3', text: 'Lose an AZ: back within 5 minutes, internet access included', target: { rtoSec: 300, rpoSec: 60 } },
    { id: 'r4', text: 'Under $650/month (about $1,600 today)', target: { budget: 650 } },
  ],
  refactor: { change: 'The SRE review: "One NAT for two AZs is a single point of failure." Finance: "And why is moving data inside AWS our biggest cost?"' },
  budget: 650,
  usage: {
    ...usage0,
    requestsPerMonth: 20_000_000,
    dataOutGb: 100,
    s3StorageGb: 2000,
    s3GetRequests: 5_000_000,
    flows: [
      { from: 'asg', to: 'svc:s3', gbPerMonth: 20_000 },
      { from: 'asg', to: 'internet', gbPerMonth: 300 },
    ],
  },
  defaults: 'helpful',
  layout: azLayout,
  palette: ['nat', 'vpce', 'asg', 'alb', 'rds', 's3'],
  startingBoard: oneNat().done(),
  events: [
    { id: 'reach', name: 'Readers open the feed', desc: 'HTTPS from the internet through the load balancer to the app tier.', domain: 'resilient', concepts: ['alb'], kind: 'reachability', params: { from: 'internet', to: 'alb', port: 443, expect: 'allow' }, requirementIds: ['r1'] },
    { id: 'payments', name: 'Charge a subscription', desc: 'Every app server calls the payments API over HTTPS on the internet.', domain: 'secure', concepts: ['nat-gateway'], kind: 'reachability', params: { from: 'asg', to: 'internet', port: 443, expect: 'allow' }, requirementIds: ['r2'] },
    { id: 'az-outage', name: 'us-east-1a goes dark', desc: 'An AZ failure at 300 rps. Servers in us-east-1b must keep their internet access.', domain: 'resilient', concepts: ['nat-gateway', 'cross-az-costs', 'static-stability'], kind: 'azOutage', params: { az: 'us-east-1a', loadRps: 300, rtoSec: 300, rpoSec: 60, requireOutbound: true }, requirementIds: ['r3'] },
    { id: 'bill', name: 'Monthly bill', desc: '20 TB from S3 and 300 GB of API calls a month, priced along the real network path.', domain: 'cost', concepts: ['cross-az-costs', 'nat-data-processing', 'vpc-gateway-endpoints'], kind: 'bill', params: {}, requirementIds: ['r4'], passesOnEmptyBoard: true },
  ],
  questions: ['q-rf-az-1', 'q-rf-az-2', 'q-rf-az-3', 'q-rf-az-4'],
  concepts: ['cross-az-costs', 'nat-data-processing', 'vpc-gateway-endpoints', 'nat-gateway', 'elasticache'],
  reference: endpoint(natPerAz(), ['rtb-private-a', 'rtb-private-b']).done(),
  mistakes: [
    { name: 'NAT per AZ, no endpoint', board: natPerAz().done(), expectFail: ['bill'] },
    { name: 'Endpoint on only one route table', board: endpoint(natPerAz(), ['rtb-private-a']).done(), expectFail: ['bill'] },
    { name: 'Endpoint added, still one NAT', board: endpoint(oneNat(), ['rtb-private-a', 'rtb-private-b']).done(), expectFail: ['az-outage'] },
    { name: 'NAT removed, endpoint only', board: endpoint(feed().remove('nat-a'), ['rtb-private-a', 'rtb-private-b']).done(), expectFail: ['payments'] },
  ],
  keywords: ['NAT gateway charges + S3 traffic → gateway endpoint', 'one NAT gateway per AZ (cheaper and resilient)', 'cross-AZ transfer ≈ $0.01/GB each way', 'keep traffic in the same AZ where safe'],
  hints: ['A free path to S3 for every private subnet', 'Each AZ uses its own NAT gateway'],
};

export const REFACTORS: Mission[] = [spotBatch, steadyState, rightSizeDb, coldData, chattyAz];
