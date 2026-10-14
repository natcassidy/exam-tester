// Section 10 (Route 53) and section 11 (classic solutions architecture).

import { BoardBuilder } from '../../engine/builder';
import type { VpcLayout } from '../../engine/model';
import { inRegion, lab, regionOnly, threeTierVpc, usage0 } from './helpers';

// =====================================================================================
// 10a. A day-long TTL and no failover (finish).
// =====================================================================================

const twoRegions: VpcLayout = { ...regionOnly(), extraVpcs: [{ regionId: 'us-west-2', regionName: 'US West (Oregon)' }] };

function statusApis(): BoardBuilder {
  return new BoardBuilder(twoRegions, 'helpful')
    .place('lambda', 'us-east-1', { name: 'east-status' })
    .place('apigw', 'us-east-1', { name: 'east-api' })
    .config('east-api', { integration: { kind: 'lambda', targetId: 'east-status' } })
    .place('lambda', 'us-west-2', { name: 'west-status' })
    .place('apigw', 'us-west-2', { name: 'west-api' })
    .config('west-api', { integration: { kind: 'lambda', targetId: 'west-status' } })
    .place('route53', '', { name: 'status-dns' });
}

const failover = (hc: boolean) => [
  { id: 'rec-east', targetId: 'east-api', healthCheck: hc, failover: 'primary' as const },
  { id: 'rec-west', targetId: 'west-api', healthCheck: hc, failover: 'secondary' as const },
];

const dnsStart = () => statusApis().config('status-dns', { recordName: 'status.rivetpay.com', policy: 'simple', aliasTargetId: 'east-api', alias: false, ttlSec: 86400 });
const dnsRef = () => statusApis().config('status-dns', { recordName: 'status.rivetpay.com', policy: 'failover', records: failover(true), alias: true, healthCheck: { intervalSec: 10, failureThreshold: 3 } });

export const failoverLab = lab({
  id: 'c-r53-failover',
  course: { section: 10, kind: 'finish', lectures: ['Route 53 - TTL', 'Route 53 CNAME vs Alias', 'Route 53 - Health Checks', 'Routing Policy - Failover'] },
  title: 'A day-long TTL',
  client: 'RivetPay, a payments startup',
  users: 'Merchants checking status.rivetpay.com when something looks wrong',
  brief:
    "Our status API runs in us-east-1 with an identical copy in us-west-2 that nobody uses. When us-east-1 had a bad hour, the status page went down with it, which is the worst possible moment. Fail over to us-west-2 within five minutes. The record was set up years ago as a plain record with a 24-hour TTL 'to save on DNS queries'.",
  requirements: [
    { id: 'r1', text: 'Merchants reach the status API by name' },
    { id: 'r2', text: 'Lose us-east-1: served from us-west-2 within 5 minutes', target: { rtoSec: 300, rpoSec: 0 } },
  ],
  budget: 0,
  usage: usage0,
  layout: twoRegions,
  palette: ['route53', 'apigw', 'lambda'],
  start: { board: dnsStart().done(), fails: ['region-outage'] },
  events: [
    { id: 'reach', name: 'Merchant checks status', desc: 'HTTPS to status.rivetpay.com.', domain: 'resilient', concepts: ['route53-alias'], kind: 'reachability', params: { from: 'internet', to: 'route53', port: 443, expect: 'allow', label: { to: 'the status record' } }, requirementIds: ['r1'] },
    { id: 'region-outage', name: 'us-east-1 goes dark', desc: 'The primary Region stops answering. Route 53 has to notice, and resolvers have to stop using the old answer.', domain: 'resilient', concepts: ['route53-routing-policies', 'route53-alias', 'dr-strategies'], kind: 'regionOutage', params: { region: 'us-east-1', loadRps: 50, rtoSec: 300, rpoSec: 0, dns: 'route53' }, requirementIds: ['r2'] },
  ],
  concepts: ['route53-routing-policies', 'route53-alias', 'dr-strategies'],
  reference: dnsRef().done(),
  mistakes: [
    { name: 'Failover records without health checks', board: dnsRef().config('status-dns', { records: failover(false) }).done(), expectFail: ['region-outage'] },
    { name: 'Failover with health checks, still a 24-hour TTL', board: dnsRef().config('status-dns', { alias: false, ttlSec: 86400 }).done(), expectFail: ['region-outage'] },
  ],
  keywords: ['active-passive → failover routing + health check on the primary', 'TTL: how long resolvers cache the answer', 'alias records: free queries, the target\'s TTL, work at the zone apex', 'CNAME cannot be used at the zone apex'],
  hints: ['A routing policy with a primary and a secondary', 'Something must tell Route 53 the primary is down', 'How long will resolvers keep the old answer?'],
  distractors: ['cloudfront', 'dynamodb', 's3'],
  decisions: [
    {
      title: 'Failover routing with health checks, as an alias',
      choice: 'A primary record for east-api and a secondary for west-api, health checked every 10 s, as alias records.',
      why: 'Failover routing answers with the primary while its health check passes and switches to the secondary when it fails. Without a health check Route 53 never knows. Alias records answer with the target\'s own short TTL and are free to query, where a plain record keeps resolvers on the dead Region for its whole TTL.',
      events: ['reach', 'region-outage'],
      components: ['status-dns'],
      manual: ['route53-routing-policies', 'route53-alias'],
    },
    {
      title: 'A warm copy in the second Region',
      choice: 'west-api and west-status stay deployed in us-west-2.',
      why: 'Failover only helps if something is already running where DNS sends people. Serverless costs nothing while idle, so the standby is free until it is needed.',
      events: ['region-outage'],
      components: ['west-api'],
      manual: ['dr-strategies'],
    },
  ],
});

// =====================================================================================
// 10b. Every player to the nearest Region (finish): latency routing with health checks.
// =====================================================================================

const threeRegions: VpcLayout = {
  ...regionOnly(),
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

function quizApis(): BoardBuilder {
  const b = new BoardBuilder(threeRegions, 'helpful');
  for (const [r, s] of REGIONS) b.place('lambda', r, { name: `${s}-quiz` }).place('apigw', r, { name: `${s}-api` }).config(`${s}-api`, { integration: { kind: 'lambda', targetId: `${s}-quiz` } });
  return b
    .place('dynamodb', 'us-east-1', { name: 'questions' })
    .config('questions', { replicaRegions: ['eu-west-1', 'ap-southeast-2'] })
    .place('route53', '', { name: 'quiz-dns' })
    .config('quiz-dns', { recordName: 'api.quizzly.app', aliasTargetId: 'us-api' });
}

const latency = (hc: boolean) => REGIONS.map(([, s]) => ({ id: `rec-${s}`, targetId: `${s}-api`, healthCheck: hc }));

export const latencyLab = lab({
  id: 'c-r53-latency',
  course: { section: 10, kind: 'finish', lectures: ['Routing Policy - Latency', 'Routing Policy - Geolocation', 'Routing Policy - Weighted', 'Route 53 - Health Checks'] },
  title: 'Nearest Region wins',
  client: 'Quizzly, a live trivia app',
  users: 'Players in the US, Europe and Australia answering against a 10-second clock',
  brief:
    "We deployed our quiz API to Virginia, Ireland and Sydney, and the question table is a global table in all three. But DNS still sends everyone to Virginia, so Sydney players lose rounds on latency alone. Send every player to the closest Region, and if a Region fails, players there should land on the next closest within five minutes.",
  requirements: [
    { id: 'r1', text: 'Players in Virginia, London and Sydney get a question in ≤ 60 ms', target: { p95Ms: 60 } },
    { id: 'r2', text: 'Lose us-east-1: American players back within 5 min', target: { rtoSec: 300, rpoSec: 5 } },
  ],
  budget: 0,
  usage: usage0,
  layout: threeRegions,
  palette: ['route53', 'apigw', 'lambda', 'dynamodb'],
  start: { board: quizApis().done(), fails: ['latency', 'region-outage'] },
  events: [
    { id: 'latency', name: 'Round starts everywhere', desc: 'Players in Virginia, London and Sydney fetch the next question.', domain: 'performant', concepts: ['route53-routing-policies', 'dynamodb-global-tables'], kind: 'globalLatency', params: { cities: ['virginia', 'london', 'sydney'], maxMs: 60, writes: false, table: 'dynamodb' }, requirementIds: ['r1'] },
    { id: 'region-outage', name: 'us-east-1 goes dark', desc: 'Virginia fails mid-round. American players must be sent elsewhere.', domain: 'resilient', concepts: ['route53-routing-policies', 'dynamodb-global-tables'], kind: 'regionOutage', params: { region: 'us-east-1', loadRps: 500, rtoSec: 300, rpoSec: 5, clientCity: 'virginia' }, requirementIds: ['r2'] },
  ],
  concepts: ['route53-routing-policies', 'dynamodb-global-tables', 'route53-alias'],
  reference: quizApis().config('quiz-dns', { policy: 'latency', records: latency(true) }).done(),
  mistakes: [
    { name: 'Latency records without health checks', board: quizApis().config('quiz-dns', { policy: 'latency', records: latency(false) }).done(), expectFail: ['region-outage'] },
    {
      name: 'Geolocation without a default record',
      board: quizApis()
        .config('quiz-dns', {
          policy: 'geolocation',
          records: [
            { id: 'rec-us', targetId: 'us-api', healthCheck: true, location: 'NA' },
            { id: 'rec-eu', targetId: 'eu-api', healthCheck: true, location: 'EU' },
            { id: 'rec-ap', targetId: 'ap-api', healthCheck: true, location: 'OC' },
          ],
        })
        .done(),
      expectFail: ['region-outage'],
    },
  ],
  keywords: ['lowest latency for global users → latency-based routing', 'geolocation = by the user\'s location (compliance, localisation), needs a default record', 'health checks make Route 53 skip a failed Region', 'global tables: a local replica in each Region'],
  hints: ['A routing policy that picks the Region with the lowest latency for each user', 'One record per Region', 'Health checks so a dead Region stops being an answer'],
  distractors: ['cloudfront', 'sqs', 's3'],
  whyNot: { cloudfront: 'CloudFront caches responses, but quiz questions change every round. Players need the API itself close by, with the data next to it.', sqs: 'A queue decouples work that can wait. A quiz answer cannot wait in a queue.' },
  decisions: [
    {
      title: 'Latency-based routing with health checks',
      choice: 'One latency record per Region, each health checked.',
      why: 'Latency routing answers each resolver with the Region that has the lowest measured latency for it. With health checks, a failed Region drops out and its players get the next best Region. Geolocation routes by where the user is, for compliance or localisation, and needs a default record for everyone else.',
      events: ['latency', 'region-outage'],
      components: ['quiz-dns'],
      manual: ['route53-routing-policies'],
    },
    {
      title: 'Data next to every API',
      choice: 'questions is a global table with replicas in all three Regions.',
      why: 'Routing a Sydney player to Sydney only helps if the data is there too; a read that crosses the Pacific undoes the win.',
      events: ['latency'],
      components: ['questions'],
      manual: ['dynamodb-global-tables'],
    },
  ],
});

// =====================================================================================
// 11a. WhatsTheTime.com (build): stateless, highly available, elastic.
// =====================================================================================

const timeLayout = inRegion(threeTierVpc('vpc-time', 80, ['app']));

function whatsTheTime(): BoardBuilder {
  return new BoardBuilder(timeLayout, 'helpful')
    .place('alb', 'public-a', { name: 'time-alb' })
    .place('asg', 'app-a', { name: 'time-asg' })
    .config('time-asg', { instanceType: 't3.small', min: 2, desired: 2, max: 10, healthCheckType: 'ELB', policy: { kind: 'targetTracking', targetCpu: 50 } })
    .place('route53', '', { name: 'time-dns' })
    .config('time-dns', { recordName: 'whatsthetime.com', aliasTargetId: 'time-alb' });
}

const morning = [
  { min: 0, rps: 100 },
  { min: 10, rps: 100 },
  { min: 30, rps: 500 },
  { min: 60, rps: 500 },
];

export const whatsTheTimeLab = lab({
  id: 'c-sa-time',
  course: { section: 11, kind: 'build', lectures: ['WhatsTheTime.com', 'Elastic Load Balancing (ELB) Overview', 'Auto Scaling Groups (ASG) Overview', 'Route 53 CNAME vs Alias'] },
  title: 'WhatsTheTime.com',
  client: 'WhatsTheTime.com, the course\'s favourite startup',
  users: '100 requests a second, 500 every morning; no database, no sessions',
  brief:
    "We tell people the time. That's it. No database, no user accounts. It started on one instance with an Elastic IP, and every time that instance hiccupped we were down. Make it highly available across AZs, let it grow every morning and shrink at night, reachable at whatsthetime.com, and only the load balancer faces the internet.",
  requirements: [
    { id: 'r1', text: 'Visitors reach whatsthetime.com over HTTPS' },
    { id: 'r2', text: 'Morning peak (5×): ≤ 1% errors, p95 ≤ 800 ms', target: { p95Ms: 800 } },
    { id: 'r3', text: 'Lose an AZ: back within 5 minutes', target: { rtoSec: 300 } },
    { id: 'r4', text: 'App servers private, reached only through the load balancer' },
    { id: 'r5', text: 'Under $250/month', target: { budget: 250 } },
  ],
  budget: 250,
  usage: { ...usage0, requestsPerMonth: 300_000_000, dataOutGb: 100 },
  layout: timeLayout,
  palette: ['route53', 'alb', 'asg', 'ec2'],
  events: [
    { id: 'reach', name: 'Visitor checks the time', desc: 'HTTPS to whatsthetime.com.', domain: 'resilient', concepts: ['route53-alias', 'alb'], kind: 'reachability', params: { from: 'internet', to: 'route53', port: 443, expect: 'allow', label: { to: 'a DNS record' } }, requirementIds: ['r1'] },
    { id: 'peak', name: 'Morning peak', desc: 'Traffic climbs from 100 to 500 rps over 20 minutes.', domain: 'performant', concepts: ['asg-scaling'], kind: 'traffic', params: { entry: 'alb', profile: morning, durationMin: 60, slo: { errorRate: 0.01, p95Ms: 800 }, baseLatencyMs: 40 }, requirementIds: ['r2'] },
    { id: 'az-outage', name: 'us-east-1a goes dark', desc: 'An AZ fails at 100 rps.', domain: 'resilient', concepts: ['static-stability', 'alb-health-checks'], kind: 'azOutage', params: { az: 'us-east-1a', loadRps: 100, rtoSec: 300, rpoSec: 60 }, requirementIds: ['r3'] },
    { id: 'audit', name: 'Security review', desc: 'Private app tier, chained security groups, HTTPS.', domain: 'secure', concepts: ['sg-chaining', 'vpc-public-private'], kind: 'audit', params: { rules: ['appTierPrivate', 'privateTierSgsChained', 'httpsOnly'] }, requirementIds: ['r4'] },
    { id: 'bill', name: 'Monthly bill', desc: '300M requests a month.', domain: 'cost', concepts: ['asg-scaling'], kind: 'bill', params: {}, requirementIds: ['r5'], passesOnEmptyBoard: true },
  ],
  concepts: ['alb', 'asg-scaling', 'static-stability', 'route53-alias', 'sg-chaining'],
  reference: whatsTheTime().done(),
  mistakes: [
    {
      name: 'One public instance with an Elastic IP',
      board: new BoardBuilder(timeLayout, 'helpful')
        .place('ec2', 'public-a', { name: 'time-server' })
        .config('time-server', { publicIp: true })
        .sgRule('time-server', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } })
        .place('route53', '', { name: 'time-dns' })
        .config('time-dns', { recordName: 'whatsthetime.com', aliasTargetId: 'time-server' })
        .done(),
      expectFail: ['peak', 'az-outage', 'audit'],
    },
    { name: 'Auto Scaling group in one AZ', board: whatsTheTime().subnets('time-asg', ['app-a']).done(), expectFail: ['az-outage'] },
    { name: 'Max capacity 2', board: whatsTheTime().config('time-asg', { max: 2 }).done(), expectFail: ['peak'] },
  ],
  keywords: ['stateless web tier → ALB + Auto Scaling group across AZs', 'Route 53 alias to the ALB (works at the zone apex)', 'scale out in the morning, in at night', 'Elastic IP on one instance is not HA'],
  hints: ['A load balancer in the public subnets', 'An Auto Scaling group in the private app subnets of both AZs, with a scaling policy', 'A Route 53 alias record to the load balancer'],
  distractors: ['cloudfront', 'rds', 'nat', 'waf'],
  whyNot: {
    ec2: 'A single instance (even with an Elastic IP) is the starting point the course moves away from: it can\'t survive an AZ or a surge.',
    nat: 'The app tier never starts connections to the internet here, so a NAT gateway would be pure cost.',
    rds: 'WhatsTheTime has no data to store. A database is the next lesson (MyClothes.com).',
  },
  decisions: [
    {
      title: 'A load balancer in front, alias in DNS',
      choice: 'time-alb in the public subnets; whatsthetime.com is a Route 53 alias to it.',
      why: 'The load balancer is the one stable entry point while instances come and go. An alias record works at the zone apex (a CNAME cannot) and follows the load balancer\'s changing IPs.',
      events: ['reach', 'audit'],
      components: ['time-alb', 'time-dns'],
      manual: ['alb', 'route53-alias'],
    },
    {
      title: 'An Auto Scaling group across two AZs',
      choice: 'time-asg in app-a and app-b, min 2, max 10, target tracking on CPU, ELB health checks, private, chained to the load balancer.',
      why: 'Spreading over AZs survives a data centre; the scaling policy adds instances for the morning peak and removes them at night, so you pay for the baseline only.',
      events: ['peak', 'az-outage', 'audit', 'bill'],
      components: ['time-asg'],
      manual: ['asg-scaling', 'static-stability'],
    },
  ],
});

// =====================================================================================
// 11b. MyClothes.com (finish): add a stateful data tier to a stateless web tier.
// =====================================================================================

const clothesLayout = inRegion(threeTierVpc('vpc-clothes', 81));

function clothesWeb(): BoardBuilder {
  return new BoardBuilder(clothesLayout, 'helpful')
    .place('alb', 'public-a', { name: 'shop-alb' })
    .place('asg', 'app-a', { name: 'shop-asg' })
    .config('shop-asg', { min: 2, desired: 2, max: 8, healthCheckType: 'ELB', policy: { kind: 'targetTracking', targetCpu: 50 } });
}

const clothesDb = (cfg: Record<string, unknown> = {}) => clothesWeb().place('rds', 'data-a', { name: 'shop-db' }).config('shop-db', { multiAz: true, storageEncrypted: true, backupRetentionDays: 7, ...cfg });

export const myClothesLab = lab({
  id: 'c-sa-clothes',
  course: { section: 11, kind: 'finish', lectures: ['MyClothes.com', 'MyWordPress.com', 'RDS Read Replicas vs Multi AZ', 'RDS Security'] },
  title: 'MyClothes.com',
  client: 'MyClothes.com, an online clothing store',
  users: 'Shoppers with carts and accounts; orders stored in a relational database',
  brief:
    "Our web tier is already stateless behind a load balancer. Now we need somewhere to keep customer accounts and orders: a relational database that survives losing an AZ without losing orders, that only the web tier can reach, encrypted because it holds addresses. Shopping carts go in the database too for now.",
  requirements: [
    { id: 'r1', text: 'The web tier can query the database' },
    { id: 'r2', text: 'The database is unreachable from the internet' },
    { id: 'r3', text: 'Lose an AZ: RTO ≤ 5 min, RPO ≤ 1 min', target: { rtoSec: 300, rpoSec: 60 } },
    { id: 'r4', text: 'Passes the security review' },
  ],
  budget: 0,
  usage: usage0,
  layout: clothesLayout,
  palette: ['alb', 'asg', 'rds', 'aurora', 'dynamodb', 'nat'],
  start: { board: clothesWeb().done(), fails: ['app-db', 'db-private'] },
  events: [
    { ...appDb3306(), requirementIds: ['r1'] },
    { id: 'db-private', name: 'Attacker probes the database', desc: 'Someone on the internet tries port 3306 on the database.', domain: 'secure', concepts: ['vpc-public-private'], kind: 'reachability', params: { from: 'internet', to: 'rds', port: 3306, expect: 'deny', label: { to: 'a database' } }, requirementIds: ['r2'] },
    { id: 'az-outage', name: 'us-east-1a goes dark', desc: 'An AZ fails at 150 rps, with the primary database in it.', domain: 'resilient', concepts: ['rds-multi-az', 'static-stability'], kind: 'azOutage', params: { az: 'us-east-1a', loadRps: 150, rtoSec: 300, rpoSec: 60 }, requirementIds: ['r3'] },
    { id: 'audit', name: 'Security review', desc: 'Private database, chained security groups, encryption at rest.', domain: 'secure', concepts: ['sg-chaining', 'encryption-at-rest'], kind: 'audit', params: { rules: ['dbNotPublic', 'privateTierSgsChained', 'dbSgLeastPrivilege', 'encryptionAtRest'] }, requirementIds: ['r2', 'r4'] },
  ],
  concepts: ['rds-multi-az', 'sg-chaining', 'encryption-at-rest', 'elasticache'],
  reference: clothesDb().done(),
  mistakes: [
    { name: 'Single-AZ database', board: clothesDb({ multiAz: false }).done(), expectFail: ['az-outage'] },
    { name: 'Database open to the VPC CIDR', board: clothesDb().dropSgRules('shop-db', 'inbound', () => true).sgRule('shop-db', 'inbound', { protocol: 'tcp', fromPort: 3306, toPort: 3306, source: { cidr: '10.81.0.0/16' } }).done(), expectFail: ['audit'] },
    { name: 'Unencrypted database', board: clothesDb({ storageEncrypted: false }).done(), expectFail: ['audit'] },
  ],
  keywords: ['stateless web tier, stateful data in a managed database', 'session data → ElastiCache or DynamoDB rather than sticky sessions', 'Multi-AZ for HA, read replicas to scale reads', 'security group chaining ALB → app → DB'],
  hints: ['A relational database in the data subnets', 'Make it survive an AZ', 'Only the app tier\'s security group may reach it, and encrypt it'],
  distractors: ['s3', 'sqs', 'cloudfront'],
  whyNot: {
    aurora: 'Aurora would do the job too, at a higher floor price. RDS Multi-AZ meets every requirement here.',
    dynamodb: 'Accounts and orders are relational. DynamoDB is a good home for session data later, but not for this database.',
    nat: 'Nothing here needs outbound internet. A NAT gateway would only add cost.',
  },
  decisions: [
    {
      title: 'RDS Multi-AZ in the data subnets',
      choice: 'shop-db: MySQL, Multi-AZ, encrypted, in data-a and data-b, not publicly accessible.',
      why: 'Accounts and orders are relational and must survive an AZ without losing writes: Multi-AZ\'s synchronous standby does that. Encryption is chosen at creation.',
      events: ['app-db', 'az-outage', 'db-private', 'audit'],
      components: ['shop-db'],
      fields: ['multiAz', 'storageEncrypted', 'publiclyAccessible', 'placement'],
      manual: ['rds-multi-az', 'encryption-at-rest'],
    },
    {
      title: 'Only the app tier reaches the database',
      choice: "shop-db's group allows 3306 from shop-asg's security group.",
      why: 'Chaining ALB → app → database means each tier only trusts the one in front of it, whatever addresses its instances get.',
      events: ['audit'],
      components: ['shop-db'],
      fields: ['securityGroups'],
      manual: ['sg-chaining'],
    },
  ],
});

function appDb3306() {
  return { id: 'app-db', name: 'App queries the database', desc: 'The web tier opens MySQL connections (3306) to the database.', domain: 'secure' as const, concepts: ['sg-chaining', 'security-groups'], kind: 'reachability' as const, params: { from: 'asg', to: 'rds', port: 3306, expect: 'allow', label: { from: 'the web tier', to: 'a database' } } };
}
