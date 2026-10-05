import type { LifecycleTransition, Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import type { StorageLifecycleParams } from '../../engine/sim/events/storageLifecycle';

const layout: VpcLayout = { regionId: 'us-east-1', regionName: 'US East (N. Virginia)' };

const RETENTION = 2555;

function bucket(lifecycle: LifecycleTransition[], expireAfterDays: number | null = RETENTION): BoardBuilder {
  return new BoardBuilder(layout, 'helpful')
    .place('s3', 'us-east-1', { name: 'scans' })
    .config('scans', { versioning: true, storageClass: 'STANDARD', lifecycle, ...(expireAfterDays == null ? {} : { expireAfterDays }) });
}

const reference = () =>
  bucket([
    { afterDays: 30, toClass: 'GLACIER_IR' },
    { afterDays: 365, toClass: 'DEEP_ARCHIVE' },
  ]);

const workload: Omit<StorageLifecycleParams, 'check'> = {
  monthlyNewGb: 2048,
  avgObjectMb: 50,
  retentionDays: RETENTION,
  reads: [
    { fromDay: 0, toDay: 30, pctPerMonth: 50 },
    { fromDay: 30, toDay: 365, pctPerMonth: 2 },
    { fromDay: 365, toDay: RETENTION, pctPerMonth: 0.1 },
  ],
  retrieval: [
    { fromDay: 0, toDay: 365, maxSec: 1, label: 'A doctor opens a scan' },
    { fromDay: 365, toDay: RETENTION, maxSec: 43200, label: 'A legal records request' },
  ],
  budget: 500,
};

export const scans: Mission = {
  id: 'scans',
  stage: 3,
  mode: 'build',
  title: 'The ever-growing archive',
  client: 'Brightwater Radiology, eight imaging clinics',
  users: '2 TB of new MRI and CT scans a month; doctors read recent scans constantly, old ones almost never',
  brief:
    "Our S3 bill grows every single month because we keep every scan in S3 Standard forever. The law says we keep scans for seven years and then delete them. Doctors open a scan a lot in the first month and sometimes during the first year, and when they do it must open instantly. After a year, scans are only pulled for legal requests, and legal gives us 12 hours. Scans are irreplaceable patient records. Get the storage under $500 a month at steady state.",
  requirements: [
    { id: 'r1', text: 'Scans under a year old open in under a second; older ones within 12 hours' },
    { id: 'r2', text: 'Scans are deleted after seven years, not before' },
    { id: 'r3', text: 'No scan is ever kept in a single Availability Zone' },
    { id: 'r4', text: 'Steady-state storage bill under $500/month', target: { budget: 500 } },
  ],
  budget: 500,
  usage: { requestsPerMonth: 0, dataOutGb: 0, s3StorageGb: 2048, s3GetRequests: 1_000_000, s3PutRequests: 42_000, flows: [] },
  defaults: 'helpful',
  layout,
  palette: ['s3'],
  events: [
    { id: 'retrieval', name: 'A doctor and a lawyer', desc: 'Scans of every age are requested; each must arrive within its allowed time.', domain: 'performant', concepts: ['s3-storage-classes', 's3-lifecycle'], kind: 'storageLifecycle', params: { check: 'retrieval', ...workload }, requirementIds: ['r1'] },
    { id: 'retention', name: 'Records audit', desc: 'The auditor checks that scans are kept seven years and then removed.', domain: 'secure', concepts: ['s3-lifecycle'], kind: 'storageLifecycle', params: { check: 'retention', ...workload }, requirementIds: ['r2'] },
    { id: 'resilience', name: 'An AZ is destroyed', desc: 'A flood destroys one Availability Zone for good.', domain: 'resilient', concepts: ['s3-storage-classes'], kind: 'storageLifecycle', params: { check: 'resilience', ...workload }, requirementIds: ['r3'] },
    { id: 'cost', name: 'Year-eight storage bill', desc: 'Every age from day one to seven years is in the bucket. Storage, retrievals, transitions and minimum-duration charges.', domain: 'cost', concepts: ['s3-storage-classes', 's3-lifecycle'], kind: 'storageLifecycle', params: { check: 'cost', ...workload }, requirementIds: ['r4'] },
  ],
  questions: ['q-sc-1', 'q-sc-2', 'q-sc-3', 'q-sc-4', 'q-sc-5'],
  concepts: ['s3-storage-classes', 's3-lifecycle', 's3-versioning'],
  reference: reference().done(),
  mistakes: [
    { name: 'Deep Archive after 30 days', board: bucket([{ afterDays: 30, toClass: 'DEEP_ARCHIVE' }]).done(), expectFail: ['retrieval'] },
    { name: 'S3 Standard forever (with expiry)', board: bucket([]).done(), expectFail: ['cost'] },
    {
      name: 'One Zone-IA for the first year',
      board: bucket([
        { afterDays: 30, toClass: 'ONEZONE_IA' },
        { afterDays: 365, toClass: 'DEEP_ARCHIVE' },
      ]).done(),
      expectFail: ['resilience'],
    },
    {
      name: 'Glacier Flexible Retrieval after a year',
      board: bucket([
        { afterDays: 30, toClass: 'GLACIER_IR' },
        { afterDays: 365, toClass: 'GLACIER' },
      ]).done(),
      expectFail: ['cost'],
    },
    {
      name: 'Expire after five years',
      board: bucket(
        [
          { afterDays: 30, toClass: 'GLACIER_IR' },
          { afterDays: 365, toClass: 'DEEP_ARCHIVE' },
        ],
        1825,
      ).done(),
      expectFail: ['retention'],
    },
  ],
  keywords: ['infrequently accessed but needs millisecond retrieval → Glacier Instant Retrieval', 'archive, retrieval within 12 hours → Deep Archive', 'lifecycle policy', 'minimum storage duration', 'One Zone-IA only for re-creatable data'],
  hints: ['A lifecycle rule on the bucket', 'A class that is cheap but still instant for the first year', 'The cheapest archive class that meets 12 hours', 'An expiration at seven years'],
};
