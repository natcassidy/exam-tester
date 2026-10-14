// Section 28 (disaster recovery and migrations).

import type { VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import { lab, regionOnly, threeTierVpc, usage0 } from './helpers';

// =====================================================================================
// 28a. Backups that die with the Region (fix): AWS Backup retention, cross-Region copy, Vault Lock.
// =====================================================================================

const backupLayout: VpcLayout = { ...regionOnly(), extraVpcs: [{ regionId: 'us-west-2', regionName: 'US West (Oregon)' }] };

function claims(plan: Record<string, unknown>): BoardBuilder {
  return new BoardBuilder(backupLayout, 'helpful')
    .place('dynamodb', 'us-east-1', { name: 'claims' })
    .place('backup', 'us-east-1', { name: 'claims-backup' })
    .config('claims-backup', { resourceIds: ['claims'], frequencyHours: 24, retentionDays: 35, copyRegion: 'us-west-2', copyToOtherAccount: false, vaultLock: 'compliance', ...plan });
}

export const backupLab = lab({
  id: 'c-dr-backup',
  course: { section: 28, kind: 'fix', lectures: ['Disaster Recovery Overview', 'AWS Backup', 'AWS Backup - Hands On', 'Disaster Recovery Strategies'] },
  title: 'Backups that die with the Region',
  client: 'Wayfarer Mutual, travel insurance',
  users: 'A claims table that adjusters update all day',
  brief:
    "Our auditor read our backup plan and found three problems. Recovery points are kept for one day, but corrupted data is often found days later. Every copy lives in us-east-1. And an admin, or an attacker with an admin's keys, can delete the recovery points. Losing a day of claims in a disaster is acceptable; losing everything is not.",
  requirements: [
    { id: 'r1', text: 'Roll back corruption discovered three days later' },
    { id: 'r2', text: 'Lose us-east-1: claims back with at most 24 hours missing', target: { rpoSec: 86400 } },
    { id: 'r3', text: 'Stolen admin credentials cannot delete the recovery points' },
  ],
  budget: 0,
  usage: usage0,
  layout: backupLayout,
  palette: ['dynamodb', 'backup', 's3'],
  start: { board: claims({ retentionDays: 1, copyRegion: null, vaultLock: 'none' }).done(), fails: ['corruption', 'region-loss', 'ransomware'] },
  events: [
    { id: 'corruption', name: 'A bad batch job', desc: 'A batch job rewrites claim amounts wrongly. An adjuster notices 72 hours later.', domain: 'resilient', concepts: ['aws-backup'], kind: 'dataLoss', params: { scenario: 'corruption', target: 'dynamodb', discoveredAfterHours: 72, label: 'the claims table' }, requirementIds: ['r1'] },
    { id: 'region-loss', name: 'us-east-1 is lost', desc: 'The Region is unavailable for days.', domain: 'resilient', concepts: ['aws-backup', 'dr-strategies'], kind: 'dataLoss', params: { scenario: 'region-loss', target: 'dynamodb', rpoSec: 86400, label: 'the claims table' }, requirementIds: ['r2'] },
    { id: 'ransomware', name: 'Stolen admin keys', desc: 'An attacker with admin credentials deletes the table and tries to delete every recovery point.', domain: 'secure', concepts: ['aws-backup'], kind: 'dataLoss', params: { scenario: 'malicious-delete', target: 'dynamodb', discoveredAfterHours: 1, label: 'the claims table' }, requirementIds: ['r3'] },
  ],
  concepts: ['aws-backup', 'dr-strategies'],
  reference: claims({}).done(),
  mistakes: [
    { name: 'Copied to Oregon, still kept one day', board: claims({ retentionDays: 1 }).done(), expectFail: ['corruption'] },
    { name: '35 days and a copy, no Vault Lock', board: claims({ vaultLock: 'none' }).done(), expectFail: ['ransomware'] },
    { name: 'Vault Lock in governance mode', board: claims({ vaultLock: 'governance' }).done(), expectFail: ['ransomware'] },
  ],
  keywords: ['backup and restore: cheapest DR, RPO/RTO in hours', 'AWS Backup: plans, retention, cross-Region and cross-account copies', 'Backup Vault Lock (compliance mode) = WORM for recovery points', 'pilot light / warm standby / multi-site lower the RTO at higher cost'],
  hints: ['How far back can you restore today?', 'Where do the recovery points live?', 'A vault setting that stops anyone deleting them'],
  distractors: ['lambda', 'sqs', 'route53'],
  whyNot: {
    dynamodb: 'There is already a table: protect it, don\'t add another.',
    s3: 'Exporting to S3 is possible, but AWS Backup already handles schedules, retention, copies and locks for the table.',
  },
  decisions: [
    {
      title: 'Retention, a copy in another Region, and Vault Lock',
      choice: 'claims-backup keeps daily recovery points 35 days, copies each to us-west-2, and its vault is locked in compliance mode.',
      why: 'Retention must cover how late corruption is found. A copy in another Region survives losing the home Region: that is the backup-and-restore DR strategy, with an RPO of the backup interval. Vault Lock in compliance mode means no one, root included, can delete recovery points before they expire; governance mode can be lifted by privileged users.',
      events: ['corruption', 'region-loss', 'ransomware'],
      components: ['claims-backup'],
      manual: ['aws-backup', 'dr-strategies'],
    },
    {
      title: 'Leave the table alone',
      choice: 'claims stays a single-Region table.',
      why: 'A 24-hour RPO is what backup and restore gives, the cheapest strategy. A global table would bring the RPO down to about a second, at the price of a full second copy.',
      events: ['region-loss'],
      components: ['claims'],
      manual: ['dr-strategies'],
    },
  ],
});

// =====================================================================================
// 28b. Ten minutes of downtime (finish): DMS with ongoing replication over a Site-to-Site VPN.
// =====================================================================================

const vpc = threeTierVpc('vpc-dms', 120, ['data']);
const dmsLayout: VpcLayout = { ...regionOnly(), vpc, onprem: { name: 'Head office server room', cidr: '192.168.0.0/16', internetMbps: 500 } };

function target(): BoardBuilder {
  return new BoardBuilder(dmsLayout, 'helpful')
    .place('rds', 'data-a', { name: 'bookings-db' })
    .config('bookings-db', { engine: 'mysql', multiAz: true, storageEncrypted: true, backupRetentionDays: 7 })
    .place('dms', 'us-east-1', { name: 'bookings-migration' })
    .config('bookings-migration', { targetId: 'bookings-db', mode: 'full-load' });
}
const vpn = (b: BoardBuilder) =>
  b
    .place('vgw', 'vpc-dms', { name: 'office-vgw' })
    .place('cgw', '', { name: 'office-router' })
    .place('vpn', '', { name: 'office-vpn' })
    .config('office-vpn', { cgwId: 'office-router', attachTo: 'office-vgw' })
    .route('rtb-private-a', '192.168.0.0/16', { vgwName: 'office-vgw' })
    .route('rtb-private-b', '192.168.0.0/16', { vgwName: 'office-vgw' });
const cdc = (b: BoardBuilder) => b.config('bookings-migration', { mode: 'full-load-and-cdc' });

export const dmsLab = lab({
  id: 'c-dr-dms',
  course: { section: 28, kind: 'finish', lectures: ['Database Migration Service (DMS)', 'RDS & Aurora MySQL Migrations', 'On-Premises Strategies with AWS', 'Transferring Large Datasets into AWS'] },
  title: 'Ten minutes of downtime',
  client: 'Tern Tours, a boat tour operator',
  users: 'A 400 GB MySQL bookings database taking bookings around the clock',
  brief:
    "We're moving our bookings database from the server room to RDS. The target is ready and a DMS task exists, but the test run took the site down for hours and DMS couldn't even reach our server. Bookings can stop for at most ten minutes at cut-over. The database server has no public address and won't get one.",
  requirements: [
    { id: 'r1', text: 'Migrate the 400 GB database with ≤ 10 minutes of downtime' },
    { id: 'r2', text: 'The new database stays private and encrypted' },
  ],
  budget: 0,
  usage: usage0,
  layout: dmsLayout,
  palette: ['rds', 'dms', 'vgw', 'cgw', 'vpn', 'dx', 'snow'],
  start: { board: target().done(), fails: ['cutover'] },
  events: [
    { id: 'cutover', name: 'Cut-over night', desc: '400 GB of MySQL that takes writes all day; bookings may stop for at most 10 minutes.', domain: 'resilient', concepts: ['dms', 'site-to-site-vpn'], kind: 'migration', params: { scope: 'database', dbGb: 400, maxDowntimeMin: 10, deadlineDays: 14 }, requirementIds: ['r1'] },
    { id: 'audit', name: 'Security review', desc: 'The new database is private and encrypted.', domain: 'secure', concepts: ['encryption-at-rest', 'vpc-public-private'], kind: 'audit', params: { rules: ['dbNotPublic', 'encryptionAtRest'] }, requirementIds: ['r2'] },
  ],
  concepts: ['dms', 'site-to-site-vpn', 'data-migration', 'hybrid-connectivity'],
  reference: cdc(vpn(target())).done(),
  mistakes: [
    { name: 'VPN added, still full load only', board: vpn(target()).done(), expectFail: ['cutover'] },
    { name: 'Ongoing replication, no VPN', board: cdc(target()).done(), expectFail: ['cutover'] },
  ],
  keywords: ['migrate with minimal downtime → DMS full load + CDC (ongoing replication)', 'homogeneous MySQL → MySQL needs no SCT', 'private connectivity in days → Site-to-Site VPN; Direct Connect takes weeks', 'the source database stays online during migration'],
  hints: ['How does DMS reach a server with no public address?', 'A full load is a snapshot; what about the bookings made while it runs?', 'The task has a migration type setting'],
  distractors: ['s3', 'lambda', 'kinesis'],
  whyNot: {
    dx: 'Direct Connect takes weeks to months to arrive. A VPN is up the same day over the existing internet line.',
    snow: '400 GB copies over the line in hours. Snowball is for tens of terabytes, and could not capture the changes anyway.',
  },
  decisions: [
    {
      title: 'A Site-to-Site VPN into the VPC',
      choice: 'office-vpn connects office-router to office-vgw, and both private route tables send 192.168.0.0/16 to the VGW.',
      why: 'DMS runs in the VPC and has to reach the source privately. A VPN is encrypted, quick to set up and enough bandwidth for 400 GB. Routes in both directions are what make it work.',
      events: ['cutover'],
      components: ['office-vpn', 'office-vgw', 'office-router', 'rtb-private-a', 'rtb-private-b'],
      manual: ['site-to-site-vpn', 'hybrid-connectivity'],
    },
    {
      title: 'Full load plus change data capture',
      choice: 'bookings-migration runs full load and ongoing replication (CDC).',
      why: 'The full load copies the database while it stays online; CDC then streams every change made since, so source and target stay in sync until you switch the app over. Downtime is only the switch itself.',
      events: ['cutover'],
      components: ['bookings-migration'],
      manual: ['dms'],
    },
    {
      title: 'A private, encrypted target',
      choice: 'bookings-db is RDS MySQL, Multi-AZ, encrypted, in the data subnets.',
      why: 'Same engine on both sides means no schema conversion. Encryption has to be chosen when the target is created, before data lands in it.',
      events: ['audit'],
      components: ['bookings-db'],
      manual: ['encryption-at-rest'],
    },
  ],
});
