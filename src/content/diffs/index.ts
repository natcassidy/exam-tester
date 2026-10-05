// Spot the Difference rounds: two nearly identical boards, one event, one survivor.
// Options are tied to real config differences (checked by tests/content/diffs.test.ts).

import type { Board, EventSpec, Mission } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import { doc } from '../../engine/iam/policy';
import { INCIDENT_USAGE, prodLayout, threeTier } from '../incidents/shared';

function diffMission(m: Omit<Mission, 'stage' | 'mode' | 'budget' | 'usage' | 'defaults' | 'mistakes' | 'reference' | 'requirements' | 'layout' | 'palette' | 'events'> & { event: EventSpec; survivorBoard: Board }): Mission {
  const { event, survivorBoard, ...rest } = m;
  return {
    stage: 2,
    mode: 'diff',
    budget: 0,
    usage: INCIDENT_USAGE,
    defaults: 'bare',
    mistakes: [],
    palette: [],
    layout: prodLayout,
    requirements: [{ id: 'r1', text: 'Name the difference that decides the outcome' }],
    reference: survivorBoard,
    events: [{ ...event, requirementIds: ['r1'] }],
    ...rest,
  };
}

// ----- 1. Multi-AZ vs. a read replica -----
function dbBase(): BoardBuilder {
  return threeTier().config('app-asg', { min: 4, desired: 4, max: 8 });
}
const dbLeft = dbBase().config('app-db', { multiAz: true, readReplicas: 0, backupRetentionDays: 7 }).done();
const dbRight = dbBase().config('app-db', { multiAz: false, readReplicas: 1, backupRetentionDays: 14, instanceClass: 'db.r5.large' }).done();
const dbId = dbBase().id('app-db');

export const diffMultiAz = diffMission({
  id: 'diff-multiaz',
  title: 'Standby or replica?',
  client: 'Two copies of Ledgerly',
  users: 'Same app, same traffic',
  brief: 'Both teams say their database "has a second copy in the other AZ". us-east-1a loses power. One team is back in 90 seconds; the other is restoring from backup.',
  event: { id: 'az-outage', name: 'us-east-1a goes dark', desc: 'An AZ failure at 400 rps. Requirement: RTO ≤ 5 min, RPO ≤ 1 min.', domain: 'resilient', concepts: ['rds-multi-az', 'rds-read-replicas'], kind: 'azOutage', params: { az: 'us-east-1a', loadRps: 400, rtoSec: 300, rpoSec: 60 } },
  survivorBoard: dbLeft,
  diff: {
    left: dbLeft,
    right: dbRight,
    leftLabel: 'Team A',
    rightLabel: 'Team B',
    survivor: 'left',
    question: 'Why does Team A meet RTO ≤ 5 min and RPO ≤ 1 min while Team B does not?',
    options: [
      { id: 'a', text: "Team A's database is Multi-AZ; Team B has a Single-AZ primary plus one read replica.", why: 'Correct. Multi-AZ keeps a synchronous standby and fails over automatically in about 60-120 s with no data loss. A read replica is asynchronous and is not promoted automatically, so Team B falls back to a point-in-time restore.', changes: [`config:${dbId}:multiAz`, `config:${dbId}:readReplicas`] },
      { id: 'b', text: "Team B keeps automated backups for 14 days, twice as long as Team A's 7.", why: 'Retention only changes how far back you can restore, not how fast. Longer retention does not shorten an AZ failover.', changes: [`config:${dbId}:backupRetentionDays`] },
      { id: 'c', text: "Team B's database runs on a larger instance class (db.r5.large, not db.t3.medium).", why: 'A bigger instance adds capacity, not availability. It still lives in one AZ.', changes: [`config:${dbId}:instanceClass`] },
    ],
    correct: 'a',
    explanation: 'High availability and read scaling are different jobs. Multi-AZ = synchronous standby + automatic failover (RPO 0). Read replicas = asynchronous copies for reads; promotion is a manual (or scripted) step and can lose the replication lag.',
  },
  questions: ['q-diff1-1', 'q-diff1-2'],
  concepts: ['rds-multi-az', 'rds-read-replicas'],
  keywords: ['automatic failover', 'synchronous replication', 'read replica is not HA'],
});

// ----- 2. SG vs. NACL -----
const appNacl = (b: BoardBuilder) =>
  b
    .nacl('acl-app', 'app-nacl', 'vpc-prod')
    .naclRule('acl-app', 'inbound', { ruleNumber: 100, protocol: 'tcp', portRange: [443, 443], cidr: '10.0.0.0/23', action: 'allow' })
    .naclRule('acl-app', 'inbound', { ruleNumber: 110, protocol: 'tcp', portRange: [1024, 65535], cidr: '0.0.0.0/0', action: 'allow' })
    .naclRule('acl-app', 'outbound', { ruleNumber: 100, protocol: 'tcp', portRange: [3306, 3306], cidr: '10.0.20.0/23', action: 'allow' })
    .naclRule('acl-app', 'outbound', { ruleNumber: 110, protocol: 'tcp', portRange: [443, 443], cidr: '0.0.0.0/0', action: 'allow' })
    .associate('app-a', 'naclId', 'acl-app')
    .associate('app-b', 'naclId', 'acl-app');
const sgLeft = appNacl(threeTier()).config('web-alb', { crossZone: false }).done();
const sgRight = appNacl(threeTier())
  .naclRule('acl-app', 'outbound', { ruleNumber: 120, protocol: 'tcp', portRange: [1024, 65535], cidr: '10.0.0.0/23', action: 'allow' })
  .clearSg('app-asg', 'outbound')
  .done();
const albId = threeTier().id('web-alb');
const appSg = threeTier().sgOf('app-asg');

export const diffSgNacl = diffMission({
  id: 'diff-sg-nacl',
  title: 'Stateful or stateless?',
  client: 'Two hardened app tiers',
  users: 'Same customers, same ALB listener',
  brief: 'Both teams locked down their app tier. Team B even deleted every outbound rule from the app security group. Yet it is Team A whose site times out.',
  event: { id: 'reach', name: 'Customers reach the app', desc: 'HTTPS from the internet to the ALB, on to the app tier, and back.', domain: 'secure', concepts: ['sg-vs-nacl', 'nacls'], kind: 'reachability', params: { from: 'internet', to: 'alb', port: 443, expect: 'allow' } },
  survivorBoard: sgRight,
  diff: {
    left: sgLeft,
    right: sgRight,
    leftLabel: 'Team A',
    rightLabel: 'Team B',
    survivor: 'right',
    question: "Why do Team A's customers time out while Team B's site works?",
    options: [
      { id: 'a', text: "Team A's network ACL has no outbound rule for ephemeral ports 1024-65535.", why: "Correct. NACLs are stateless: the app's response to the ALB is a new packet to an ephemeral port and must be allowed outbound by its own rule.", changes: ['nacl:acl-app:outbound'] },
      { id: 'b', text: "Team B's app security group has no outbound rules at all, unlike Team A's.", why: "Not the cause, and not a problem: security groups are stateful. A response to an allowed inbound connection is always allowed out, whatever the outbound rules say. (Team B's instances can't start new outbound connections, though.)", changes: [`sg:${appSg}:outbound`] },
      { id: 'c', text: 'Team A turned off cross-zone load balancing on its Application Load Balancer.', why: 'Cross-zone changes how requests are spread across AZs. Every ALB node still has targets in its own AZ, so it does not break responses.', changes: [`config:${albId}:crossZone`] },
    ],
    correct: 'a',
    explanation: 'Security groups track connections (stateful); NACLs evaluate every packet on its own (stateless), in rule-number order. That is why NACL rules always come in pairs: the request one way, ephemeral ports the other way.',
  },
  questions: ['q-diff2-1', 'q-diff2-2'],
  concepts: ['sg-vs-nacl', 'nacls', 'security-groups'],
  keywords: ['stateless', 'stateful', 'ephemeral ports'],
});

// ----- 3. Gateway endpoint on one route table vs. both -----
function vpceBase(): BoardBuilder {
  return threeTier().place('s3', '', { name: 'batch-data' }).place('vpce', 'vpc-prod', { name: 's3-endpoint' });
}
const veLeft = vpceBase().config('s3-endpoint', { routeTableIds: ['rtb-private-a'] }).config('batch-data', { versioning: true }).done();
const veRight = vpceBase().config('s3-endpoint', { routeTableIds: ['rtb-private-a', 'rtb-private-b'] }).resourcePolicy('s3-endpoint', doc({ Effect: 'Allow', Principal: '*', Action: '*', Resource: '*' })).done();
const vb = vpceBase();

export const diffEndpoint = diffMission({
  id: 'diff-endpoint',
  title: 'Half an endpoint',
  client: 'Two Northwind batch fleets',
  users: '12 TB a month to S3 each',
  brief: 'Both teams added an S3 gateway endpoint to stop paying NAT data processing. Team A\'s NAT bill barely moved.',
  event: { id: 's3-path', name: 'Batch fleet writes to S3', desc: 'Every app subnet sends its S3 traffic. It must stay on the gateway endpoint, not the NAT.', domain: 'cost', concepts: ['vpc-gateway-endpoints', 'nat-data-processing'], kind: 'reachability', params: { from: 'asg', to: 'svc:s3', port: 443, expect: 'allow', expectVia: 'vpce' } },
  survivorBoard: veRight,
  diff: {
    left: veLeft,
    right: veRight,
    leftLabel: 'Team A',
    rightLabel: 'Team B',
    survivor: 'right',
    question: "Why does half of Team A's S3 traffic still go through a NAT gateway?",
    options: [
      { id: 'a', text: "Team A's endpoint is on rtb-private-a only; Team B's is on both private route tables.", why: 'Correct. A gateway endpoint works by adding a prefix-list route to the route tables it is associated with. Subnets using rtb-private-b never see that route, so their S3 traffic follows 0.0.0.0/0 to the NAT.', changes: [`config:${vb.id('s3-endpoint')}:routeTableIds`] },
      { id: 'b', text: 'Team B attached an explicit endpoint policy to its S3 gateway endpoint.', why: "This policy allows everything, exactly like the default. Endpoint policies filter what can pass; they don't change routing.", changes: [`resourcepolicy:${vb.id('s3-endpoint')}`] },
      { id: 'c', text: "Team A's bucket has versioning enabled and Team B's does not.", why: 'Versioning changes what S3 stores, not the network path to it.', changes: [`config:${vb.id('batch-data')}:versioning`] },
    ],
    correct: 'a',
    explanation: 'Gateway endpoints (S3, DynamoDB) are route-table targets. Associate them with every route table whose subnets talk to the service. They are free; interface endpoints cost per hour and per GB.',
  },
  questions: ['q-diff3-1', 'q-diff3-2'],
  concepts: ['vpc-gateway-endpoints', 'nat-data-processing'],
  keywords: ['gateway endpoint', 'route table association', 'reduce NAT costs'],
});

// ----- 4. Target tracking vs. scheduled scaling -----
function scaleBase(): BoardBuilder {
  return threeTier().config('app-asg', { min: 2, desired: 2, max: 12, warmupSec: 300, healthCheckType: 'ELB' });
}
const morning = [
  { min: 0, rps: 200 },
  { min: 9, rps: 200 },
  { min: 10, rps: 1600 },
  { min: 40, rps: 1600 },
  { min: 45, rps: 400 },
];
const scLeft = scaleBase().config('app-asg', { policy: { kind: 'targetTracking', targetCpu: 50 }, max: 12 }).done();
const scRight = scaleBase().config('app-asg', { policy: { kind: 'scheduled', actions: [{ atMin: 2, desired: 10 }] }, max: 10, healthCheckType: 'EC2' }).done();
const asgId = scaleBase().id('app-asg');

export const diffScaling = diffMission({
  id: 'diff-scaling',
  title: 'The 9 a.m. stampede',
  client: 'Two clock-in apps',
  users: '40,000 staff clock in between 9:00 and 9:05',
  brief: 'Every weekday at exactly 9:00, traffic jumps 8× in one minute. Team A trusts target tracking. Team B wrote a schedule. Only one of them has a quiet 9:01.',
  event: {
    id: 'stampede',
    name: '9:00 clock-in',
    desc: '200 rps until 8:59, 1,600 rps from 9:00 for half an hour. Minute 10 of the simulation is 9:00.',
    domain: 'performant',
    concepts: ['asg-scaling'],
    kind: 'traffic',
    params: { entry: 'alb', profile: morning, durationMin: 50, slo: { errorRate: 0.01, p95Ms: 800 }, baseLatencyMs: 60 },
  },
  survivorBoard: scRight,
  diff: {
    left: scLeft,
    right: scRight,
    leftLabel: 'Team A',
    rightLabel: 'Team B',
    survivor: 'right',
    question: 'Why does Team A drop requests at 9:00 while Team B does not?',
    options: [
      { id: 'a', text: 'Team B scales out on a schedule before 9:00; Team A waits for CPU to rise first.', why: 'Correct. Target tracking needs the metric to rise first, then waits for boot plus warmup (~6 min here). For a spike at a known time, scheduled (or predictive) scaling adds capacity before it arrives.', changes: [`config:${asgId}:policy`] },
      { id: 'b', text: "Team A can scale higher, to a maximum of 12 instances instead of Team B's 10.", why: 'A higher ceiling does not help when new capacity arrives minutes too late. Team A never even needs 12.', changes: [`config:${asgId}:max`] },
      { id: 'c', text: 'Team B uses EC2 health checks instead of ELB health checks for its group.', why: 'Health check type decides when broken instances are replaced. It has nothing to do with how fast the group grows.', changes: [`config:${asgId}:healthCheckType`] },
    ],
    correct: 'a',
    explanation: 'Dynamic scaling follows demand with a lag (metric period + boot + warmup). Predictable, sharp spikes call for scheduled scaling (or predictive scaling) so capacity is warm when the crowd arrives; keep target tracking for the unexpected.',
  },
  questions: ['q-diff4-1', 'q-diff4-2'],
  concepts: ['asg-scaling'],
  keywords: ['predictable spike', 'scheduled scaling', 'warmup'],
});

export const DIFFS: Mission[] = [diffMultiAz, diffSgNacl, diffEndpoint, diffScaling];
