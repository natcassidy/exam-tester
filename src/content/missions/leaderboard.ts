import type { Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

const layout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  extraVpcs: [
    { regionId: 'eu-west-1', regionName: 'Europe (Ireland)' },
    { regionId: 'ap-southeast-2', regionName: 'Asia Pacific (Sydney)' },
  ],
};

const REGIONS = [
  ['us-east-1', 'us'],
  ['eu-west-1', 'eu'],
  ['ap-southeast-2', 'ap'],
] as const;

const latencyRecords = (hc: boolean) => REGIONS.map(([, s]) => ({ id: `rec-${s}`, targetId: `${s}-api`, healthCheck: hc }));

function apis(b: BoardBuilder, regions = REGIONS): BoardBuilder {
  for (const [r, s] of regions) {
    b.place('lambda', r, { name: `${s}-scores` }).place('apigw', r, { name: `${s}-api` }).config(`${s}-api`, { integration: { kind: 'lambda', targetId: `${s}-scores` } });
  }
  return b;
}

function reference(): BoardBuilder {
  return apis(new BoardBuilder(layout, 'helpful'))
    .place('dynamodb', 'us-east-1', { name: 'scores' })
    .config('scores', { replicaRegions: ['eu-west-1', 'ap-southeast-2'], dax: true, pitr: true })
    .place('route53', '', { name: 'game-dns' })
    .config('game-dns', { recordName: 'api.blitzarena.gg', policy: 'latency', records: latencyRecords(true) });
}

export const leaderboard: Mission = {
  id: 'leaderboard',
  stage: 3,
  mode: 'build',
  title: 'Lag on the leaderboard',
  client: 'Blitz Arena, a mobile battle game',
  users: '2 million daily players in North America, Europe and Australia',
  brief:
    "Players in London and Sydney say submitting a score feels like dial-up, and the global top-100 board times out every evening at peak. Everything runs in us-east-1 today. We want every player to save a score in under 50 ms, the top-100 board to survive 30,000 reads a second, and if a whole Region dies the players there should be back within five minutes, losing at most a few seconds of scores.",
  requirements: [
    { id: 'r1', text: 'Players in Virginia, London and Sydney save a score in ≤ 50 ms', target: { p95Ms: 50 } },
    { id: 'r2', text: 'The global top-100 survives 30,000 reads/s' },
    { id: 'r3', text: 'Lose eu-west-1: European players back in ≤ 5 min, RPO ≤ 5 s', target: { rtoSec: 300, rpoSec: 5 } },
    { id: 'r4', text: 'Monthly bill under $2,000', target: { budget: 2000 } },
  ],
  budget: 2000,
  usage: {
    requestsPerMonth: 150_000_000,
    dataOutGb: 300,
    s3StorageGb: 0,
    s3GetRequests: 0,
    s3PutRequests: 0,
    flows: [],
    lambdaGbSeconds: 1_000_000,
    dynamoWrites: 300_000_000,
    dynamoReads: 900_000_000,
    dynamoStorageGb: 20,
    crossRegionGb: 60,
  },
  defaults: 'helpful',
  layout,
  palette: ['apigw', 'lambda', 'dynamodb', 'route53', 'cloudfront'],
  events: [
    { id: 'latency', name: 'Evening peak: everyone saves a score', desc: 'Players in Virginia, London and Sydney submit scores. Each request goes where DNS sends it and writes to the nearest copy of the table.', domain: 'performant', concepts: ['route53-routing-policies', 'dynamodb-global-tables'], kind: 'globalLatency', params: { cities: ['virginia', 'london', 'sydney'], maxMs: 50, writes: true }, requirementIds: ['r1'] },
    { id: 'hot-key', name: 'Top-100 refresh storm', desc: 'Every open app polls the same top-100 item: 30,000 reads a second, all for one key.', domain: 'performant', concepts: ['dax', 'dynamodb-capacity'], kind: 'globalLatency', params: { hotKeyReadsPerSec: 30000 }, requirementIds: ['r2'] },
    { id: 'region-outage', name: 'eu-west-1 goes dark', desc: 'Europe’s Region fails during the evening peak. Players in London must be sent elsewhere and still find their scores.', domain: 'resilient', concepts: ['dynamodb-global-tables', 'route53-routing-policies', 'dr-strategies'], kind: 'regionOutage', params: { region: 'eu-west-1', loadRps: 2000, rtoSec: 300, rpoSec: 5, clientCity: 'london' }, requirementIds: ['r3'] },
    { id: 'bill', name: 'Monthly bill', desc: '150M API calls, 300M writes replicated to every Region, DAX nodes and health checks.', domain: 'cost', concepts: ['dynamodb-global-tables', 'dax'], kind: 'bill', params: {}, requirementIds: ['r4'], passesOnEmptyBoard: true },
  ],
  questions: ['q-lb-1', 'q-lb-2', 'q-lb-3', 'q-lb-4', 'q-lb-5'],
  concepts: ['dynamodb-global-tables', 'dax', 'route53-routing-policies', 'dr-strategies', 'dynamodb-capacity'],
  reference: reference().done(),
  mistakes: [
    { name: 'Single-Region table (APIs everywhere, data in Virginia)', board: reference().config('scores', { replicaRegions: [] }).done(), expectFail: ['latency'] },
    { name: 'Simple routing to the us-east-1 API', board: reference().config('game-dns', { policy: 'simple', aliasTargetId: 'us-api' }).done(), expectFail: ['latency'] },
    { name: 'No DAX in front of the hot item', board: reference().config('scores', { dax: false }).done(), expectFail: ['hot-key'] },
    { name: 'Latency records without health checks', board: reference().config('game-dns', { records: latencyRecords(false) }).done(), expectFail: ['region-outage'] },
  ],
  keywords: ['global users with low latency', 'DynamoDB global tables (active-active, multi-Region writes)', 'latency-based routing', 'microsecond read latency → DAX', 'hot partition'],
  hints: ['An API in each Region', 'A DynamoDB global table with replicas where the players are', 'Route 53 latency routing with health checks', 'A cache for the hot item'],
};
