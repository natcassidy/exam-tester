// Sections 12 (Amazon S3 introduction), 13 (Advanced Amazon S3) and 14 (Amazon S3 security).

import type { LifecycleTransition, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import { doc } from '../../engine/iam/policy';
import type { PolicyDocument } from '../../engine/iam/types';
import type { StorageLifecycleParams } from '../../engine/sim/events/storageLifecycle';
import { lab, regionOnly, usage0 } from './helpers';

const ACCOUNT = '111122223333';
const lambdaTrust = doc({ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' });

// =====================================================================================
// 12a. The website that answers 403 (fix): static website hosting needs Block Public Access off and a public-read policy.
// =====================================================================================

function bakery(site: Record<string, unknown>): BoardBuilder {
  return new BoardBuilder(regionOnly(), 'helpful')
    .place('s3', '', { name: 'crumb-site' })
    .config('crumb-site', { staticWebsite: true, ...site })
    .place('s3', '', { name: 'crumb-drafts' });
}

const publicSite = { blockPublicAccess: false, policy: 'public-read' };

export const staticSiteLab = lab({
  id: 'c-s3-website',
  course: { section: 12, kind: 'fix', lectures: ['S3 Security: Bucket Policy', 'S3 Website Overview', 'S3 Website Hands On', 'S3 Bucket Policies Hands On'] },
  title: 'The website that answers 403',
  client: 'Crumb & Co, a neighbourhood bakery',
  users: 'Locals checking opening hours and the weekly bread list',
  brief:
    "My nephew put our website in an S3 bucket and turned on static website hosting, but every visitor gets 403 Forbidden. The site is just HTML and photos, so it's fine for anyone to read. The other bucket holds next month's menu drafts and price lists: those must stay private.",
  requirements: [
    { id: 'r1', text: 'Anyone can load the bakery website' },
    { id: 'r2', text: 'The drafts bucket stays private' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['s3', 'cloudfront', 'route53'],
  start: { board: bakery({}).done(), fails: ['visit'] },
  events: [
    { id: 'visit', name: 'A customer opens the site', desc: 'A visitor in Virginia loads the website endpoint of crumb-site.', domain: 'secure', concepts: ['s3-bucket-policy', 's3-block-public-access'], kind: 'reachability', params: { from: 'internet', to: '"crumb-site"', port: 443, expect: 'allow', label: { to: 'the website bucket' } }, requirementIds: ['r1'] },
    { id: 'drafts', name: 'A competitor guesses the drafts URL', desc: 'Someone requests an object in crumb-drafts anonymously.', domain: 'secure', concepts: ['s3-block-public-access'], kind: 'reachability', params: { from: 'internet', to: '"crumb-drafts"', port: 443, expect: 'deny', label: { to: 'the drafts bucket' } }, requirementIds: ['r2'] },
  ],
  concepts: ['s3-bucket-policy', 's3-block-public-access'],
  reference: bakery(publicSite).done(),
  mistakes: [
    { name: 'Block Public Access off, still no bucket policy', board: bakery({ blockPublicAccess: false }).done(), expectFail: ['visit'] },
    { name: 'Opened the account-wide way (both buckets public)', board: bakery(publicSite).config('crumb-drafts', publicSite).done(), expectFail: ['drafts'] },
  ],
  keywords: ['static website hosting → bucket policy granting s3:GetObject to *', 'Block Public Access overrides any public policy', '403 Forbidden on a website bucket → check BPA and the bucket policy', 'turn off BPA per bucket, not for the whole account'],
  hints: ['A 403 means S3 is refusing anonymous reads', 'Two settings on crumb-site have to agree that it is public', 'Leave crumb-drafts exactly as it is'],
  distractors: ['lambda', 'dynamodb', 'sqs'],
  whyNot: {
    cloudfront: 'CloudFront with OAC is the better long-term design (HTTPS, caching, a private bucket), and the CloudFront labs cover it. For a bakery that just wants the site up, a public website bucket is the simplest fix.',
    route53: 'A custom domain would be nice, but the website endpoint already works without one.',
  },
  decisions: [
    {
      title: 'Public website bucket: BPA off, public-read policy',
      choice: 'crumb-site has Block Public Access off and a bucket policy allowing s3:GetObject to everyone.',
      why: 'Static website hosting only serves objects that anonymous users may read. Block Public Access wins over any policy, so it must be off for this bucket, and a bucket policy must grant s3:GetObject on arn:aws:s3:::crumb-site/* to Principal "*". Either one alone still returns 403.',
      events: ['visit'],
      components: ['crumb-site'],
      manual: ['s3-bucket-policy', 's3-block-public-access'],
    },
    {
      title: 'Everything else stays blocked',
      choice: 'crumb-drafts keeps Block Public Access on and no bucket policy.',
      why: 'Block Public Access can be set per bucket or for the whole account. Open only the bucket that must be public; an account-level switch would expose every bucket that ever gets a careless policy.',
      events: ['drafts'],
      components: ['crumb-drafts'],
      manual: ['s3-block-public-access'],
    },
  ],
});

// =====================================================================================
// 12b. The photo archive (finish): versioning against deletes, Cross-Region Replication against losing a Region.
// =====================================================================================

const twoRegions: VpcLayout = { ...regionOnly(), extraVpcs: [{ regionId: 'us-west-2', regionName: 'US West (Oregon)' }] };

function photos(versioning: boolean): BoardBuilder {
  return new BoardBuilder(twoRegions, 'helpful').place('s3', 'us-east-1', { name: 'wedding-photos' }).config('wedding-photos', { versioning });
}
const withReplica = (b: BoardBuilder, region = 'us-west-2') =>
  b.place('s3', region, { name: 'wedding-photos-dr' }).config('wedding-photos-dr', { versioning: true }).config('wedding-photos', { replication: { destId: 'wedding-photos-dr', replicateDeletes: false } });

export const photoArchiveLab = lab({
  id: 'c-s3-crr',
  course: { section: 12, kind: 'finish', lectures: ['S3 Versioning', 'S3 Versioning Hands On', 'S3 Replication', 'S3 Replication Notes', 'S3 Replication Hands On'] },
  title: 'Every wedding, twice',
  client: 'Halcyon Studio, wedding photographers',
  users: '12 TB of client galleries that can never be shot again',
  brief:
    "All our client galleries live in one S3 bucket. Last week an assistant deleted a whole wedding by mistake, and we only got it back because a client had downloaded it. We need deletes to be undoable, and a second copy far away in case a whole Region goes down. Keep it simple: we're photographers, not sysadmins.",
  requirements: [
    { id: 'r1', text: 'An accidental delete can be undone' },
    { id: 'r2', text: 'Lose us-east-1: galleries survive with at most 15 minutes missing', target: { rpoSec: 900 } },
  ],
  budget: 0,
  usage: usage0,
  layout: twoRegions,
  palette: ['s3', 'backup'],
  start: { board: photos(false).done(), fails: ['oops', 'region-loss'] },
  events: [
    { id: 'oops', name: 'Wrong folder deleted', desc: 'An assistant deletes the Patel wedding folder.', domain: 'resilient', concepts: ['s3-versioning'], kind: 'dataLoss', params: { scenario: 'accidental-delete', target: 's3@us-east-1', label: 'the gallery bucket' }, requirementIds: ['r1'] },
    { id: 'region-loss', name: 'us-east-1 is unavailable', desc: 'The home Region is out for days.', domain: 'resilient', concepts: ['s3-replication'], kind: 'dataLoss', params: { scenario: 'region-loss', target: 's3@us-east-1', rpoSec: 900, label: 'the gallery bucket' }, requirementIds: ['r2'] },
  ],
  concepts: ['s3-versioning', 's3-replication'],
  reference: withReplica(photos(true)).done(),
  mistakes: [
    { name: 'Versioning only', board: photos(true).done(), expectFail: ['region-loss'] },
    { name: 'Replica in the same Region', board: withReplica(photos(true), 'us-east-1').done(), expectFail: ['region-loss'] },
  ],
  keywords: ['protect against accidental deletion → versioning (delete markers)', 'disaster recovery in another Region → Cross-Region Replication', 'replication requires versioning on both buckets', 'delete markers are not replicated by default'],
  hints: ['One bucket setting makes deletes reversible', 'A second bucket in Oregon', 'A replication rule from the gallery bucket to it'],
  distractors: ['cloudfront', 'dynamodb', 'lambda'],
  whyNot: { backup: 'AWS Backup can protect S3 too, but its copies are hours apart. Replication keeps the second copy within minutes, and versioning undoes deletes instantly.' },
  decisions: [
    {
      title: 'Versioning undoes deletes',
      choice: 'wedding-photos has versioning on.',
      why: 'With versioning a DELETE only adds a delete marker; removing the marker brings the object back. Overwrites keep the previous version too. Replication also requires versioning on both buckets.',
      events: ['oops'],
      components: ['wedding-photos'],
      fields: ['versioning'],
      manual: ['s3-versioning'],
    },
    {
      title: 'A replica in another Region',
      choice: 'wedding-photos-dr in us-west-2, versioned, with a replication rule from wedding-photos. Delete markers are not replicated.',
      why: 'Cross-Region Replication copies new objects asynchronously, usually within seconds. Existing objects need S3 Batch Replication. Leaving delete-marker replication off means a mistake in Virginia does not show up in Oregon.',
      events: ['region-loss'],
      components: ['wedding-photos', 'wedding-photos-dr'],
      fields: ['replication', 'placement', 'versioning'],
      manual: ['s3-replication'],
    },
  ],
});

// =====================================================================================
// 13a. The log bucket that never stops growing (finish): lifecycle transitions and expiration.
// =====================================================================================

const LOG_DAYS = 365;
const logWorkload: Omit<StorageLifecycleParams, 'check'> = {
  monthlyNewGb: 600,
  avgObjectMb: 8,
  retentionDays: LOG_DAYS,
  reads: [
    { fromDay: 0, toDay: 30, pctPerMonth: 40 },
    { fromDay: 30, toDay: 90, pctPerMonth: 3 },
    { fromDay: 90, toDay: LOG_DAYS, pctPerMonth: 0.2 },
  ],
  retrieval: [
    { fromDay: 0, toDay: 90, maxSec: 1, label: 'An engineer opens a log file' },
    { fromDay: 90, toDay: LOG_DAYS, maxSec: 12 * 3600, label: 'An auditor asks for an old log' },
  ],
  budget: 60,
};

function logs(lifecycle: LifecycleTransition[], expireAfterDays: number | null): BoardBuilder {
  return new BoardBuilder(regionOnly(), 'helpful')
    .place('s3', '', { name: 'app-logs' })
    .config('app-logs', { storageClass: 'STANDARD', lifecycle, expireAfterDays });
}
const logRef = () =>
  logs(
    [
      { afterDays: 30, toClass: 'STANDARD_IA' },
      { afterDays: 90, toClass: 'DEEP_ARCHIVE' },
    ],
    LOG_DAYS,
  );

export const lifecycleLab = lab({
  id: 'c-s3-lifecycle',
  course: { section: 13, kind: 'finish', lectures: ['S3 Lifecycle Rules (with S3 Analytics)', 'S3 Lifecycle Rules Hands On', 'S3 Storage Classes Overview', 'S3 Storage Classes Hands On'] },
  title: 'The log bucket that never stops growing',
  client: 'Tidewater Logistics, route planning software',
  users: '600 GB of application logs a month, kept for a year',
  brief:
    "Every log we've ever written sits in S3 Standard, and the bill grows every month. Engineers read logs a lot in the first month and now and then until three months; after that only auditors ask, and they give us half a day. Policy says logs are deleted after one year. Logs are our audit evidence, so they must survive losing an AZ.",
  requirements: [
    { id: 'r1', text: 'Logs under 90 days open instantly; older ones within 12 hours' },
    { id: 'r2', text: 'Logs are deleted after one year, not before' },
    { id: 'r3', text: 'No log is kept in a single AZ' },
    { id: 'r4', text: 'Steady-state storage under $60/month', target: { budget: 60 } },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['s3'],
  start: { board: logs([], null).done(), fails: ['retention', 'cost'] },
  events: [
    { id: 'retrieval', name: 'Someone needs a log', desc: 'Logs of every age are requested; each must arrive within its allowed time.', domain: 'performant', concepts: ['s3-storage-classes', 's3-lifecycle'], kind: 'storageLifecycle', params: { check: 'retrieval', ...logWorkload }, requirementIds: ['r1'] },
    { id: 'retention', name: 'Retention audit', desc: 'Logs must be kept a year, then deleted.', domain: 'secure', concepts: ['s3-lifecycle'], kind: 'storageLifecycle', params: { check: 'retention', ...logWorkload }, requirementIds: ['r2'] },
    { id: 'resilience', name: 'An AZ is destroyed', desc: 'One Availability Zone is lost for good.', domain: 'resilient', concepts: ['s3-storage-classes'], kind: 'storageLifecycle', params: { check: 'resilience', ...logWorkload }, requirementIds: ['r3'] },
    { id: 'cost', name: 'Steady-state bill', desc: 'Every age from one day to a year is in the bucket.', domain: 'cost', concepts: ['s3-storage-classes', 's3-lifecycle'], kind: 'storageLifecycle', params: { check: 'cost', ...logWorkload }, requirementIds: ['r4'] },
  ],
  concepts: ['s3-lifecycle', 's3-storage-classes', 's3-intelligent-tiering'],
  reference: logRef().done(),
  mistakes: [
    { name: 'Glacier Flexible Retrieval after 30 days', board: logs([{ afterDays: 30, toClass: 'GLACIER' }], LOG_DAYS).done(), expectFail: ['retrieval'] },
    { name: 'One Zone-IA after 30 days', board: logs([{ afterDays: 30, toClass: 'ONEZONE_IA' }, { afterDays: 90, toClass: 'DEEP_ARCHIVE' }], LOG_DAYS).done(), expectFail: ['resilience'] },
    { name: 'Transitions right, no expiration', board: logRef().config('app-logs', { expireAfterDays: null }).done(), expectFail: ['retention'] },
    { name: 'Expire after 180 days', board: logs([{ afterDays: 30, toClass: 'STANDARD_IA' }, { afterDays: 90, toClass: 'DEEP_ARCHIVE' }], 180).done(), expectFail: ['retention'] },
  ],
  keywords: ['infrequent access, milliseconds → Standard-IA (30-day minimum)', 'archive, hours acceptable → Glacier Flexible / Deep Archive', 'lifecycle rule: transition actions + expiration action', 'One Zone-IA only for data you can re-create'],
  hints: ['Open app-logs and add lifecycle transitions', 'A class that is cheaper but still instant for months 2 and 3', 'The cheapest archive class auditors can wait for, then an expiration'],
  distractors: ['backup', 'athena', 'dynamodb'],
  decisions: [
    {
      title: 'Transitions that follow the access pattern',
      choice: 'S3 Standard for 30 days, Standard-IA until day 90, then Glacier Deep Archive.',
      why: 'Standard-IA costs about half of Standard and still answers in milliseconds, but charges per GB retrieved and has a 30-day minimum. Deep Archive is the cheapest class and returns objects within 12 hours, which the auditors accept. Glacier Flexible would break the first-90-days rule, and One Zone-IA keeps one copy in one AZ.',
      events: ['retrieval', 'resilience', 'cost'],
      components: ['app-logs'],
      fields: ['lifecycle', 'storageClass'],
      manual: ['s3-storage-classes', 's3-lifecycle'],
    },
    {
      title: 'Expire at one year',
      choice: 'An expiration action deletes logs 365 days after creation.',
      why: 'A lifecycle expiration enforces the retention policy without a cleanup script. Deleting early breaks the policy; keeping data forever is both a compliance finding and a growing bill.',
      events: ['retention'],
      components: ['app-logs'],
      fields: ['expireAfterDays'],
      manual: ['s3-lifecycle'],
    },
  ],
});

// =====================================================================================
// 14a. The key that only admins could use (fix): SSE-KMS with a customer managed key needs a key policy for the app.
// =====================================================================================

const CONTRACTS = 'arn:aws:s3:::signed-contracts';
const KEY_ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const keyAdmins = { Sid: 'KeyAdministrators', Effect: 'Allow' as const, Principal: { AWS: `arn:aws:iam::${ACCOUNT}:role/security-admin` }, Action: 'kms:*', Resource: '*' };
const appUse = { Sid: 'ContractsFunctionUse', Effect: 'Allow' as const, Principal: { AWS: `arn:aws:iam::${ACCOUNT}:role/contracts-fn-role` }, Action: ['kms:Decrypt', 'kms:GenerateDataKey'], Resource: '*' };

function contracts(keyPolicy: PolicyDocument, bucket: Record<string, unknown> = {}): BoardBuilder {
  return new BoardBuilder(regionOnly(), 'helpful')
    .place('apigw', '', { name: 'contracts-api' })
    .place('lambda', '', { name: 'contracts-fn' })
    .place('s3', '', { name: 'signed-contracts' })
    .config('contracts-api', { integration: { kind: 'lambda', targetId: 'contracts-fn' } })
    .role({ name: 'contracts-fn-role', kind: 'role', description: 'Execution role for contracts-fn', trust: lambdaTrust, policies: [{ name: 'contracts-bucket', doc: doc({ Sid: 'ContractObjects', Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'], Resource: `${CONTRACTS}/*` }) }] })
    .role({ name: 'security-admin', kind: 'role', description: 'Security team, administers keys', trust: doc({ Effect: 'Allow', Principal: { AWS: ACCOUNT }, Action: 'sts:AssumeRole' }), policies: [{ name: 'kms-admin', doc: doc({ Effect: 'Allow', Action: 'kms:*', Resource: '*' }) }] })
    .role({ name: 'sales-analyst', kind: 'user', description: 'Can list and download contract files, must not read their contents', policies: [{ name: 'read-contracts', doc: doc({ Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: [CONTRACTS, `${CONTRACTS}/*`] }) }] })
    .attachRole('contracts-fn', 'contracts-fn-role')
    .key(KEY_ID, 'contracts', keyPolicy)
    .config('signed-contracts', { encryption: 'SSE-KMS', kmsKeyId: KEY_ID, versioning: true, ...bucket });
}

export const kmsBucketLab = lab({
  id: 'c-s3-kms',
  course: { section: 14, kind: 'fix', lectures: ['S3 Encryption', 'S3 Encryption Hands On', 'S3 Default Encryption', 'KMS Key Policies'] },
  title: 'The key only admins could turn',
  client: 'Inkwell Legal, e-signature software',
  users: 'A function that stores and serves signed contracts',
  brief:
    "Compliance made us encrypt contracts with our own KMS key instead of the S3 default. Since the switch, the contracts function gets AccessDenied on every upload and download, even though its role allows GetObject and PutObject. Sales analysts can list and download files for reporting, but must never be able to read a contract's contents. And no, we can't go back to the default key.",
  requirements: [
    { id: 'r1', text: 'contracts-fn can store and read contracts' },
    { id: 'r2', text: 'The sales analyst cannot decrypt contracts' },
    { id: 'r3', text: 'Contracts stay encrypted with the customer managed key' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['apigw', 'lambda', 's3'],
  start: { board: contracts(doc(keyAdmins)).done(), fails: ['read', 'write'] },
  events: [
    { id: 'write', name: 'Store a signed contract', desc: 'contracts-fn calls s3:PutObject; S3 asks KMS for a data key on its behalf.', domain: 'secure', concepts: ['kms-key-policies', 'encryption-at-rest'], kind: 'iamAccess', params: { principal: 'lambda', action: 's3:PutObject', resource: '"signed-contracts"', objectKey: '2026/10/acme-msa.pdf', expect: 'allow', label: { principal: 'the contracts function', resource: 'the contracts bucket' } }, requirementIds: ['r1'] },
    { id: 'read', name: 'Serve a contract', desc: 'contracts-fn calls s3:GetObject; S3 asks KMS to decrypt the data key.', domain: 'secure', concepts: ['kms-key-policies'], kind: 'iamAccess', params: { principal: 'lambda', action: 's3:GetObject', resource: '"signed-contracts"', objectKey: '2026/10/acme-msa.pdf', expect: 'allow', label: { principal: 'the contracts function', resource: 'the contracts bucket' } }, requirementIds: ['r1'] },
    { id: 'analyst', name: 'Analyst downloads a contract', desc: 'The sales analyst (S3 read access, no key access) calls s3:GetObject on a contract.', domain: 'secure', concepts: ['kms-key-policies', 'resource-vs-identity-policies'], kind: 'iamAccess', params: { principal: 'user:sales-analyst', action: 's3:GetObject', resource: '"signed-contracts"', objectKey: '2026/10/acme-msa.pdf', expect: 'deny', label: { principal: 'the sales analyst', resource: 'the contracts bucket' } }, requirementIds: ['r2'] },
    { id: 'audit', name: 'Compliance check', desc: 'Contracts must be encrypted with the company-controlled key.', domain: 'secure', concepts: ['kms-key-policies', 'encryption-at-rest'], kind: 'audit', params: { rules: ['s3CustomerManagedKey', 's3BlockPublicAccess'] }, requirementIds: ['r3'] },
  ],
  concepts: ['kms-key-policies', 'encryption-at-rest', 'resource-vs-identity-policies'],
  reference: contracts(doc(keyAdmins, appUse)).done(),
  mistakes: [
    { name: 'Switched back to SSE-S3', board: contracts(doc(keyAdmins), { encryption: 'SSE-S3', kmsKeyId: null }).done(), expectFail: ['analyst', 'audit'] },
    { name: 'Key policy lets everyone use the key', board: contracts(doc(keyAdmins, { Sid: 'Everyone', Effect: 'Allow', Principal: { AWS: '*' }, Action: ['kms:Decrypt', 'kms:GenerateDataKey'], Resource: '*' })).done(), expectFail: ['analyst'] },
  ],
  keywords: ['SSE-KMS: the caller needs S3 permissions and kms:Decrypt / kms:GenerateDataKey on the key', 'a KMS key policy is required; without a statement for a principal, IAM policies alone don\'t work', 'AccessDenied after switching to a CMK → key policy', 'separation of duties: S3 access ≠ key access'],
  hints: ['The S3 permissions are fine. What else does S3 need on the caller\'s behalf?', 'Open the contracts key\'s key policy', 'Grant the function\'s role only Decrypt and GenerateDataKey'],
  distractors: ['dynamodb', 'sqs', 'cloudfront'],
  decisions: [
    {
      title: 'The key policy names the function\'s role',
      choice: 'A key policy statement lets contracts-fn-role call kms:Decrypt and kms:GenerateDataKey. Nobody else gets key usage.',
      why: 'Every KMS call is checked against the key policy first. Unless the key policy grants the principal directly, or delegates to IAM with the "Enable IAM User Permissions" statement for the account root, no identity policy can grant access. Uploads need GenerateDataKey; downloads need Decrypt. An analyst with S3 access but no key access sees only ciphertext: that is the separation SSE-KMS buys you.',
      events: ['read', 'write', 'analyst'],
      components: ['contracts'],
      manual: ['kms-key-policies', 'resource-vs-identity-policies'],
    },
    {
      title: 'Keep SSE-KMS with the customer managed key',
      choice: 'signed-contracts uses SSE-KMS with the contracts key as default encryption.',
      why: 'A customer managed key gives you a key policy, CloudTrail records of every use, and the power to disable the key. SSE-S3 encrypts too, but anyone with s3:GetObject can read the data: with SSE-S3 the analyst would read every contract.',
      events: ['analyst', 'audit'],
      components: ['signed-contracts'],
      manual: ['encryption-at-rest'],
    },
  ],
});

// =====================================================================================
// 14b. WORM for the regulator (fix): Object Lock governance mode can be bypassed; compliance cannot.
// =====================================================================================

const FIVE_YEARS = 1825;

function trades(lock: { mode: 'none' | 'governance' | 'compliance'; retentionDays: number } | null, extra: Record<string, unknown> = {}): BoardBuilder {
  return new BoardBuilder(regionOnly(), 'helpful')
    .place('s3', '', { name: 'trade-records' })
    .config('trade-records', { versioning: true, ...(lock ? { objectLock: lock } : {}), ...extra });
}

export const objectLockLab = lab({
  id: 'c-s3-lock',
  course: { section: 14, kind: 'fix', lectures: ['S3 Object Lock & Glacier Vault Lock', 'S3 MFA Delete', 'S3 Access Points', 'S3 Pre-Signed URLs'] },
  title: 'Locked, but not for admins',
  client: 'Marlowe Securities, a brokerage',
  users: 'Trade confirmations the regulator says must be kept five years, unaltered',
  brief:
    "We turned on Object Lock for trade records, so we thought we were compliant. Then an internal audit showed that one of our admins deleted a batch of locked records to 'clean up a test'. The regulator requires write-once-read-many for five years: nobody, including admins and the root user, may delete or overwrite a record early. Accidental deletes by staff must still be undoable.",
  requirements: [
    { id: 'r1', text: 'An accidental delete can be undone' },
    { id: 'r2', text: 'No one can delete a record within five years' },
    { id: 'r3', text: 'Stolen admin credentials cannot destroy records' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['s3', 'backup'],
  start: { board: trades({ mode: 'governance', retentionDays: FIVE_YEARS }).done(), fails: ['early', 'stolen'] },
  events: [
    { id: 'oops', name: 'A clerk deletes the wrong day', desc: 'A clerk deletes yesterday\'s confirmations by mistake.', domain: 'resilient', concepts: ['s3-versioning'], kind: 'dataLoss', params: { scenario: 'accidental-delete', target: 's3', label: 'the trade records bucket' }, requirementIds: ['r1'] },
    { id: 'early', name: 'Early purge', desc: 'An admin tries to delete three-year-old records.', domain: 'secure', concepts: ['s3-object-lock'], kind: 'dataLoss', params: { scenario: 'early-delete', target: 's3', retentionDays: FIVE_YEARS, label: 'the trade records bucket' }, requirementIds: ['r2'] },
    { id: 'stolen', name: 'Stolen admin keys', desc: 'An attacker with an administrator\'s keys deletes every version of every record.', domain: 'secure', concepts: ['s3-object-lock'], kind: 'dataLoss', params: { scenario: 'malicious-delete', target: 's3', label: 'the trade records bucket' }, requirementIds: ['r3'] },
  ],
  concepts: ['s3-object-lock', 's3-versioning'],
  reference: trades({ mode: 'compliance', retentionDays: FIVE_YEARS }).done(),
  mistakes: [
    { name: 'Compliance mode, one-year retention', board: trades({ mode: 'compliance', retentionDays: 365 }).done(), expectFail: ['early'] },
    { name: 'MFA Delete instead of Object Lock', board: trades(null, { mfaDelete: true }).done(), expectFail: ['early'] },
  ],
  keywords: ['WORM → S3 Object Lock', 'governance mode: users with s3:BypassGovernanceRetention can delete', 'compliance mode: nobody, not even root, can delete or shorten retention', 'Object Lock requires versioning'],
  hints: ['Object Lock has two modes', 'Which mode can an admin bypass?', 'Retention has to cover five years'],
  distractors: ['dynamodb', 'lambda', 'cloudfront'],
  whyNot: { backup: 'Backups restore data after the fact; the regulator wants deletion to be impossible in the first place.' },
  decisions: [
    {
      title: 'Compliance mode for five years',
      choice: 'trade-records has Object Lock in compliance mode with 1,825 days of default retention, on top of versioning.',
      why: 'Governance mode protects against ordinary users, but anyone with s3:BypassGovernanceRetention can delete locked versions. Compliance mode cannot be bypassed or shortened by anyone, including the root user, until retention expires. MFA Delete only guards permanent deletes behind the root user\'s MFA: it is not WORM.',
      events: ['oops', 'early', 'stolen'],
      components: ['trade-records'],
      manual: ['s3-object-lock', 's3-versioning'],
    },
    {
      title: 'Versioning underneath',
      choice: 'Versioning stays on (Object Lock requires it).',
      why: 'A delete without a version ID only adds a delete marker, so a clerk\'s mistake is undone by removing the marker. Locked versions themselves stay put.',
      events: ['oops'],
      components: ['trade-records'],
      fields: ['versioning'],
      manual: ['s3-versioning'],
    },
  ],
});
