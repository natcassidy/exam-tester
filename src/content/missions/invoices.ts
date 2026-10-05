import type { Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

const layout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  extraVpcs: [{ regionId: 'us-west-2', regionName: 'US West (Oregon)' }],
};

const VAULT_ACCOUNT = '999988887777';
const SEVEN_YEARS = 2555;

function base(): BoardBuilder {
  return new BoardBuilder(layout, 'helpful')
    .place('s3', 'us-east-1', { name: 'invoices' })
    .place('dynamodb', 'us-east-1', { name: 'invoice-index' })
    .config('invoice-index', { pitr: true });
}

function replica(b: BoardBuilder, region = 'us-west-2', account = VAULT_ACCOUNT): BoardBuilder {
  return b
    .place('s3', region, { name: 'invoices-replica' })
    .config('invoices-replica', { versioning: true })
    .account('invoices-replica', account)
    .config('invoices', { replication: { destId: 'invoices-replica', replicateDeletes: false } });
}

const locked = (mode: 'compliance' | 'governance' = 'compliance') => base().config('invoices', { versioning: true, objectLock: { mode, retentionDays: SEVEN_YEARS } });

const reference = () => replica(locked());

const bucket = 's3@us-east-1';

export const invoices: Mission = {
  id: 'invoices',
  stage: 3,
  mode: 'build',
  title: 'Seven years, no excuses',
  client: 'Penny Lane Payments, invoicing for small businesses',
  users: '9 million invoice PDFs, 5 TB and growing; an index table customers search',
  brief:
    "Our competitor lost every invoice when an attacker got an admin's keys and emptied their bucket. Regulators require us to keep invoices for seven years, unaltered, and nobody, not even our own admins, may delete one early. We also need to survive losing a Region with at most 15 minutes of invoices missing, and if a bad deploy scrambles the index table we need to roll it back, even if we only notice two days later.",
  requirements: [
    { id: 'r1', text: 'An accidental delete can be undone' },
    { id: 'r2', text: 'Invoices are WORM for seven years: no one can delete them early' },
    { id: 'r3', text: 'Survives an attacker with stolen admin credentials' },
    { id: 'r4', text: 'Lose us-east-1: RPO ≤ 15 min', target: { rpoSec: 900 } },
    { id: 'r5', text: 'Roll the index table back after corruption found 48 h later' },
    { id: 'r6', text: 'Monthly bill under $400', target: { budget: 400 } },
  ],
  budget: 400,
  usage: { requestsPerMonth: 0, dataOutGb: 50, s3StorageGb: 5000, s3GetRequests: 2_000_000, s3PutRequests: 3_000_000, flows: [], dynamoWrites: 20_000_000, dynamoReads: 100_000_000, dynamoStorageGb: 10, crossRegionGb: 150 },
  defaults: 'helpful',
  layout,
  palette: ['s3', 'dynamodb', 'backup'],
  events: [
    { id: 'accidental', name: 'Oops, wrong prefix', desc: 'A support engineer runs a cleanup script against the wrong prefix and deletes 40,000 invoices.', domain: 'resilient', concepts: ['s3-versioning'], kind: 'dataLoss', params: { scenario: 'accidental-delete', target: bucket, label: 'the invoice bucket' }, requirementIds: ['r1'] },
    { id: 'retention', name: 'Early purge', desc: 'A manager asks IT to delete a customer’s invoices from last year to “tidy up”. The regulator says that must be impossible.', domain: 'secure', concepts: ['s3-object-lock'], kind: 'dataLoss', params: { scenario: 'early-delete', target: bucket, retentionDays: SEVEN_YEARS, label: 'the invoice bucket' }, requirementIds: ['r2'] },
    { id: 'ransomware', name: 'Stolen admin keys', desc: 'An attacker with an administrator’s access keys deletes every version of every invoice, then demands a ransom.', domain: 'secure', concepts: ['s3-object-lock', 's3-replication', 'aws-organizations'], kind: 'dataLoss', params: { scenario: 'malicious-delete', target: bucket, label: 'the invoice bucket' }, requirementIds: ['r3'] },
    { id: 'region-loss', name: 'us-east-1 is lost', desc: 'The primary Region is unavailable for days.', domain: 'resilient', concepts: ['s3-replication', 'dr-strategies'], kind: 'dataLoss', params: { scenario: 'region-loss', target: bucket, rpoSec: 900, label: 'the invoice bucket' }, requirementIds: ['r4'] },
    { id: 'corruption', name: 'Scrambled index', desc: 'A deploy writes garbage into the index table. Someone notices two days later.', domain: 'resilient', concepts: ['dynamodb-capacity', 'aws-backup'], kind: 'dataLoss', params: { scenario: 'corruption', target: 'dynamodb', discoveredAfterHours: 48, label: 'the index table' }, requirementIds: ['r5'] },
    { id: 'bill', name: 'Monthly bill', desc: '5 TB of invoices, a replica copy and the index table.', domain: 'cost', concepts: ['s3-storage-classes', 's3-replication'], kind: 'bill', params: {}, requirementIds: ['r6'], passesOnEmptyBoard: true },
  ],
  questions: ['q-iv-1', 'q-iv-2', 'q-iv-3', 'q-iv-4', 'q-iv-5'],
  concepts: ['s3-versioning', 's3-object-lock', 's3-replication', 'aws-backup', 'aws-organizations', 'dynamodb-capacity'],
  reference: reference().done(),
  mistakes: [
    { name: 'Versioning only', board: base().config('invoices', { versioning: true }).done(), expectFail: ['retention', 'ransomware', 'region-loss'] },
    { name: 'Object Lock in governance mode', board: replica(locked('governance')).done(), expectFail: ['retention'] },
    { name: 'Replica in the same account, no Object Lock', board: replica(base().config('invoices', { versioning: true }), 'us-west-2', '111122223333').done(), expectFail: ['retention', 'ransomware'] },
    { name: 'No point-in-time recovery on the index', board: reference().config('invoice-index', { pitr: false }).done(), expectFail: ['corruption'] },
    { name: 'Same-Region Replication', board: replica(locked(), 'us-east-1').done(), expectFail: ['region-loss'] },
  ],
  keywords: ['WORM → S3 Object Lock (compliance mode)', 'protect against accidental deletion → versioning + MFA Delete', 'ransomware → cross-account copies, Vault Lock', 'Cross-Region Replication', 'point-in-time recovery'],
  hints: ['Versioning on the bucket', 'Object Lock in the right mode for seven years', 'A replica bucket in another Region and another account', 'Point-in-time recovery on the table'],
};
