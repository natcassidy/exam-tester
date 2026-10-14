// Section 9 (RDS, Aurora and ElastiCache).

import { BoardBuilder } from '../../engine/builder';
import { inRegion, lab, threeTierVpc, usage0 } from './helpers';

const layout = inRegion(threeTierVpc('vpc-db', 70));

function app(): BoardBuilder {
  return new BoardBuilder(layout, 'helpful')
    .place('alb', 'public-a', { name: 'app-alb' })
    .place('asg', 'app-a', { name: 'app-asg' })
    .config('app-asg', { min: 3, desired: 3, max: 8, healthCheckType: 'ELB', policy: { kind: 'targetTracking', targetCpu: 50 } });
}

const appDb = (port: number) => ({ id: 'app-db', name: 'App queries the database', desc: `The app tier opens connections to the database on ${port}.`, domain: 'secure' as const, concepts: ['sg-chaining', 'security-groups'], kind: 'reachability' as const, params: { from: 'asg', to: 'rds', port, expect: 'allow', label: { from: 'the app tier', to: 'a database' } } });
const dbPrivate = (port: number) => ({ id: 'db-private', name: 'Attacker probes the database', desc: `Someone on the internet tries port ${port} on the database.`, domain: 'secure' as const, concepts: ['vpc-public-private'], kind: 'reachability' as const, params: { from: 'internet', to: 'rds', port, expect: 'deny', label: { to: 'a database' } } });

// =====================================================================================
// 9a. A replica is not a standby (fix): Multi-AZ for failover, encryption at rest.
// =====================================================================================

const db = (b: BoardBuilder, cfg: Record<string, unknown>) => b.place('rds', 'data-a', { name: 'orders-db' }).config('orders-db', { multiAz: true, storageEncrypted: true, backupRetentionDays: 7, ...cfg });

export const multiAzLab = lab({
  id: 'c-rds-multiaz',
  course: { section: 9, kind: 'fix', lectures: ['Amazon RDS Overview', 'RDS Read Replicas vs Multi AZ', 'Amazon RDS Hands On', 'RDS Security'] },
  title: 'A replica is not a standby',
  client: 'Saltmarsh Outfitters, an online store',
  users: 'Orders all day; the database is the one thing that must not go down',
  brief:
    "Our consultant said 'add a read replica for high availability', so we did. Then an AZ had a problem and the store was down for half an hour while someone promoted the replica by hand, and we lost the last few seconds of orders. Also, the auditors just noticed the database isn't encrypted. We need automatic failover within five minutes, at most a minute of lost data, and encryption.",
  requirements: [
    { id: 'r1', text: 'The app can query the database; the internet cannot' },
    { id: 'r2', text: 'Lose an AZ: RTO ≤ 5 min, RPO ≤ 1 min', target: { rtoSec: 300, rpoSec: 60 } },
    { id: 'r3', text: 'Database encrypted at rest and not publicly accessible' },
  ],
  budget: 0,
  usage: usage0,
  layout,
  palette: ['alb', 'asg', 'rds', 'aurora', 'backup'],
  start: { board: db(app(), { multiAz: false, readReplicas: 1, storageEncrypted: false }).done(), fails: ['az-outage', 'audit'] },
  events: [
    { ...appDb(3306), requirementIds: ['r1'] },
    { ...dbPrivate(3306), requirementIds: ['r1'] },
    { id: 'az-outage', name: 'us-east-1a goes dark', desc: 'The AZ holding the primary database fails at 150 rps.', domain: 'resilient', concepts: ['rds-multi-az', 'rds-read-replicas'], kind: 'azOutage', params: { az: 'us-east-1a', loadRps: 150, rtoSec: 300, rpoSec: 60 }, requirementIds: ['r2'] },
    { id: 'audit', name: 'Audit', desc: 'Encryption at rest, private database.', domain: 'secure', concepts: ['encryption-at-rest', 'vpc-public-private'], kind: 'audit', params: { rules: ['encryptionAtRest', 'dbNotPublic'] }, requirementIds: ['r3'] },
  ],
  concepts: ['rds-multi-az', 'rds-read-replicas', 'encryption-at-rest', 'rds-backups'],
  reference: db(app(), {}).done(),
  mistakes: [
    { name: 'Encrypted, still only a read replica', board: db(app(), { multiAz: false, readReplicas: 1 }).done(), expectFail: ['az-outage'] },
    { name: 'Multi-AZ, still unencrypted', board: db(app(), { storageEncrypted: false }).done(), expectFail: ['audit'] },
    { name: 'Made publicly accessible "for the BI tool"', board: db(app(), {}).subnets('orders-db', ['public-a', 'public-b']).config('orders-db', { publiclyAccessible: true }).sgRule('orders-db', 'inbound', { protocol: 'tcp', fromPort: 3306, toPort: 3306, source: { cidr: '0.0.0.0/0' } }).done(), expectFail: ['db-private', 'audit'] },
  ],
  keywords: ['high availability, automatic failover → Multi-AZ (synchronous standby)', 'read scaling → read replicas (asynchronous)', 'encryption must be chosen at creation: snapshot, copy encrypted, restore', 'DNS name stays the same on failover'],
  hints: ['Which RDS feature fails over on its own, synchronously?', 'Encryption at rest is a database setting', 'The replica was for reads: the store has no read problem'],
  distractors: ['dynamodb', 'nat', 'route53'],
  whyNot: {
    aurora: 'Aurora would also fail over quickly, but migrating engines is a bigger change than turning on Multi-AZ, and the brief asks for neither.',
    backup: 'Backups bring data back after a mistake. Restoring takes far longer than five minutes, so they cannot meet the AZ failover target.',
  },
  decisions: [
    {
      title: 'Multi-AZ for failover; replicas are for reads',
      choice: 'orders-db is Multi-AZ, with no read replica.',
      why: 'Multi-AZ keeps a synchronous standby and fails over automatically in a minute or two behind the same DNS name, losing nothing. A read replica is asynchronous and has to be promoted by hand: it scales reads, it is not HA.',
      events: ['az-outage'],
      components: ['orders-db'],
      fields: ['multiAz', 'readReplicas'],
      manual: ['rds-multi-az', 'rds-read-replicas'],
    },
    {
      title: 'Encrypted at rest',
      choice: 'Storage encrypted with KMS.',
      why: 'In AWS you choose encryption when the instance is created. To encrypt an existing database: snapshot it, copy the snapshot with encryption on, and restore. Replicas and backups of an encrypted database are encrypted too.',
      events: ['audit'],
      components: ['orders-db'],
      fields: ['storageEncrypted'],
      manual: ['encryption-at-rest'],
    },
    {
      title: 'Private, reached only from the app tier',
      choice: 'orders-db sits in the data subnets, not publicly accessible, and its security group allows 3306 from the app tier\'s group.',
      why: 'A BI tool or an admin reaches a private database through a bastion, a VPN or Session Manager port forwarding, never a public endpoint.',
      events: ['app-db', 'db-private', 'audit'],
      components: ['orders-db'],
      fields: ['publiclyAccessible', 'placement', 'securityGroups'],
      manual: ['vpc-public-private', 'sg-chaining'],
    },
  ],
});

// =====================================================================================
// 9b. The reporting rush (finish): read replicas for read-heavy load.
// =====================================================================================

const rush = [
  { min: 0, rps: 100 },
  { min: 10, rps: 100 },
  { min: 20, rps: 400 },
  { min: 50, rps: 400 },
  { min: 60, rps: 150 },
];

const reports = (cfg: Record<string, unknown>) => db(app(), { multiAz: false, ...cfg });

export const readReplicaLab = lab({
  id: 'c-rds-replicas',
  course: { section: 9, kind: 'finish', lectures: ['RDS Read Replicas vs Multi AZ', 'Amazon Aurora', 'Amazon Aurora - Advanced Concepts', 'ElastiCache for Solution Architects'] },
  title: 'The Monday reporting rush',
  client: 'Ledgerline, a bookkeeping app',
  users: '100 requests a second, 400 when everyone runs reports on Monday morning; 90% of queries are reads',
  brief:
    "Every Monday at nine our customers open their dashboards and the database melts: CPU at 100%, timeouts everywhere. The app tier scales fine; it's the database. Nine queries out of ten are reads. We can't afford to just buy the biggest instance class, and the app can send reads to a separate endpoint if we give it one.",
  requirements: [
    { id: 'r1', text: 'Monday rush: ≤ 1% errors, p95 ≤ 800 ms', target: { p95Ms: 800 } },
    { id: 'r2', text: 'Under $500/month', target: { budget: 500 } },
  ],
  budget: 500,
  usage: { ...usage0, requestsPerMonth: 300_000_000, dataOutGb: 200, rdsStorageGb: 100 },
  layout,
  palette: ['alb', 'asg', 'rds', 'aurora'],
  start: { board: reports({}).done(), fails: ['rush'] },
  events: [
    { id: 'rush', name: 'Monday 9 a.m.', desc: 'Traffic jumps from 100 to 400 rps for half an hour. Each request runs 10 queries, 90% of them reads.', domain: 'performant', concepts: ['rds-read-replicas', 'db-right-sizing'], kind: 'traffic', params: { entry: 'alb', profile: rush, durationMin: 70, slo: { errorRate: 0.01, p95Ms: 800 }, baseLatencyMs: 60, db: { queriesPerRequest: 10, readFraction: 0.9 } }, requirementIds: ['r1'] },
    { id: 'bill', name: 'Monthly bill', desc: 'The app tier, the database and any replicas.', domain: 'cost', concepts: ['db-right-sizing'], kind: 'bill', params: {}, requirementIds: ['r2'], passesOnEmptyBoard: true },
  ],
  concepts: ['rds-read-replicas', 'db-right-sizing', 'aurora', 'elasticache'],
  reference: reports({ readReplicas: 2 }).done(),
  mistakes: [
    { name: 'One replica is not enough', board: reports({ readReplicas: 1 }).done(), expectFail: ['rush'] },
    { name: 'Scale up to db.r5.xlarge instead', board: reports({ instanceClass: 'db.r5.xlarge' }).done(), expectFail: ['bill'] },
  ],
  keywords: ['read-heavy → read replicas (up to 15), app sends reads to the replica endpoints', 'replication is asynchronous: reads are eventually consistent', 'repeated identical reads → ElastiCache', 'Aurora: up to 15 replicas behind one reader endpoint'],
  hints: ['Most of the load is reads', 'RDS can copy the database to instances that serve only reads', 'How many copies does 400 rps × 10 queries × 90% need?'],
  distractors: ['dynamodb', 'cloudfront', 'sqs'],
  whyNot: {
    aurora: 'Aurora replicas would work too (one reader endpoint), but moving engines costs more here than two RDS replicas.',
    dynamodb: 'Rewriting a relational bookkeeping app onto a key-value store is not a Monday-morning fix.',
  },
  decisions: [
    {
      title: 'Read replicas take the reads',
      choice: 'Two read replicas of the db.t3.medium primary; the app sends reads to them.',
      why: 'Writes stay on the primary; reads spread across the replicas, so the primary\'s load drops to the writes plus a share of reads. Replication is asynchronous, so a replica can be a moment behind: fine for dashboards.',
      events: ['rush', 'bill'],
      components: ['orders-db'],
      fields: ['readReplicas', 'instanceClass'],
      manual: ['rds-read-replicas', 'db-right-sizing'],
    },
    {
      title: 'Leave the app tier alone',
      choice: 'The Auto Scaling group already scales on CPU; nothing changes there.',
      why: 'The bottleneck is the database. Adding app servers only adds connections to the database that is already at 100%.',
      events: ['rush'],
      components: ['app-asg'],
      manual: ['asg-scaling'],
    },
  ],
});

// =====================================================================================
// 9c. Connection refused on 3306 (fix): PostgreSQL listens on 5432; least privilege on the database group.
// =====================================================================================

const pg = () => app().place('rds', 'data-a', { name: 'catalog-db' }).config('catalog-db', { engine: 'postgres', port: 5432, multiAz: true, storageEncrypted: true });
const pgRef = () => pg().dropSgRules('catalog-db', 'inbound', () => true).sgRule('catalog-db', 'inbound', { protocol: 'tcp', fromPort: 5432, toPort: 5432, source: { sgOf: 'app-asg' }, description: 'PostgreSQL from the app tier' });

export const dbPortLab = lab({
  id: 'c-rds-ports',
  course: { section: 9, kind: 'fix', lectures: ['List of Ports to be familiar with', 'RDS Security', 'Amazon RDS Hands On', 'Security Groups & Classic Ports Overview'] },
  title: 'The wrong port',
  client: 'Bramble Books, an online bookshop',
  users: 'A catalogue app that just moved from MySQL to PostgreSQL',
  brief:
    "We migrated the catalogue from MySQL to PostgreSQL over the weekend. The new database is up, but the app can't connect: every query times out. The database security group was copied from the old one. Whatever you change, only the app tier may reach the database.",
  requirements: [
    { id: 'r1', text: 'The app tier can query the PostgreSQL database' },
    { id: 'r2', text: 'Nothing but the app tier can reach the database' },
  ],
  budget: 0,
  usage: usage0,
  layout,
  palette: ['alb', 'asg', 'rds'],
  start: { board: pg().dropSgRules('catalog-db', 'inbound', () => true).sgRule('catalog-db', 'inbound', { protocol: 'tcp', fromPort: 3306, toPort: 3306, source: { sgOf: 'app-asg' } }).done(), fails: ['app-db'] },
  events: [
    { ...appDb(5432), requirementIds: ['r1'] },
    { ...dbPrivate(5432), requirementIds: ['r2'] },
    { id: 'audit', name: 'Database access review', desc: 'Only the app tier\'s security group may reach the database; the database stays private.', domain: 'secure', concepts: ['sg-chaining'], kind: 'audit', params: { rules: ['dbSgLeastPrivilege', 'dbNotPublic'] }, requirementIds: ['r2'] },
  ],
  concepts: ['security-groups', 'sg-chaining', 'vpc-public-private'],
  reference: pgRef().done(),
  mistakes: [
    { name: 'Open 5432 to the whole VPC CIDR', board: pg().dropSgRules('catalog-db', 'inbound', () => true).sgRule('catalog-db', 'inbound', { protocol: 'tcp', fromPort: 5432, toPort: 5432, source: { cidr: '10.70.0.0/16' } }).done(), expectFail: ['audit'] },
    { name: 'Also allowed the load balancer "just in case"', board: pgRef().sgRule('catalog-db', 'inbound', { protocol: 'tcp', fromPort: 5432, toPort: 5432, source: { sgOf: 'app-alb' } }).done(), expectFail: ['audit'] },
  ],
  keywords: ['ports: 22 SSH, 3389 RDP, 80/443 HTTP(S), 3306 MySQL/Aurora MySQL/MariaDB, 5432 PostgreSQL, 1433 SQL Server, 1521 Oracle', 'timeout → security group', 'source = the app tier security group'],
  hints: ['Which port does PostgreSQL listen on?', 'Look at catalog-db\'s inbound rule', 'Keep the app tier\'s group as the source'],
  distractors: ['nat', 'ec2', 'aurora'],
  decisions: [
    {
      title: 'The engine\'s port, from the app tier only',
      choice: "catalog-db's group allows TCP 5432 from app-asg's security group, and nothing else.",
      why: 'PostgreSQL listens on 5432; a rule for MySQL\'s 3306 lets nothing useful in, so connections time out. The exam expects you to know the standard ports. A security group as the source keeps the rule correct as app instances come and go, where a CIDR or a port range lets more in than needed.',
      events: ['app-db', 'audit'],
      components: ['catalog-db'],
      manual: ['security-groups', 'sg-chaining'],
    },
    {
      title: 'The database stays private',
      choice: 'catalog-db in the data subnets, not publicly accessible.',
      why: 'Fixing connectivity is never a reason to make a database public: the app tier reaches it inside the VPC.',
      events: ['db-private', 'audit'],
      components: ['catalog-db'],
      fields: ['publiclyAccessible', 'placement'],
      manual: ['vpc-public-private'],
    },
  ],
});
