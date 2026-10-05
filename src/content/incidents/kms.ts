import type { Mission } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import { doc } from '../../engine/iam/policy';
import { ACCOUNT, incidentBase, prodLayout } from './shared';

const BUCKET = 'arn:aws:s3:::finance-reports';
const KEY_ID = '1f2e3d4c-5b6a-4789-8abc-def012345678';
const ec2Trust = doc({ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' });
const admins = { Sid: 'KeyAdministrators', Effect: 'Allow' as const, Principal: { AWS: `arn:aws:iam::${ACCOUNT}:role/key-admin` }, Action: 'kms:*', Resource: '*' };

function start(): BoardBuilder {
  return new BoardBuilder(prodLayout, 'helpful')
    .place('asg', 'app-a', { name: 'report-asg' })
    .config('report-asg', { min: 2, desired: 2, max: 4 })
    .place('s3', '', { name: 'finance-reports' })
    .place('vpce', 'vpc-prod', { name: 's3-endpoint' })
    .config('s3-endpoint', { routeTableIds: ['rtb-private-a', 'rtb-private-b'] })
    .role({ name: 'report-role', kind: 'role', description: 'Instance profile for the reporting fleet', trust: ec2Trust, policies: [{ name: 'finance-bucket', doc: doc({ Sid: 'FinanceBucket', Effect: 'Allow', Action: 's3:*', Resource: [BUCKET, `${BUCKET}/*`] }) }] })
    .role({ name: 'key-admin', kind: 'role', description: 'Security team key administrators', trust: doc({ Effect: 'Allow', Principal: { AWS: ACCOUNT }, Action: 'sts:AssumeRole' }), policies: [{ name: 'kms-admin', doc: doc({ Effect: 'Allow', Action: 'kms:*', Resource: '*' }) }] })
    .role({ name: 'analyst', kind: 'user', description: 'Can list and read report objects, but must never see their contents', policies: [{ name: 'read-reports', doc: doc({ Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: [BUCKET, `${BUCKET}/*`] }) }] })
    .attachRole('report-asg', 'report-role')
    .key(KEY_ID, 'finance-reports', doc(admins))
    .config('finance-reports', { encryption: 'SSE-KMS', kmsKeyId: KEY_ID, versioning: true });
}

const startingBoard = start().done();
const b = start();
const bucket = b.id('finance-reports');

export const kmsIncident: Mission = {
  ...incidentBase(),
  id: 'inc-kms',
  title: "The key that wouldn't turn",
  client: 'Northwind finance',
  users: 'Month-end reports for the CFO, due at 09:00',
  brief:
    "The nightly reporting job failed: it can't read last month's figures or write the new report. Its role has full S3 access to the bucket, nobody changed that, and the bucket policy hasn't changed in months. The only change this week was the security team 'tightening the key policy' on the finance encryption key.",
  requirements: [
    { id: 'r1', text: 'The reporting fleet can read and write reports again' },
    { id: 'r2', text: 'Analysts still cannot decrypt report contents' },
    { id: 'r3', text: 'Reports stay encrypted with the customer managed key' },
  ],
  layout: prodLayout,
  startingBoard,
  events: [
    { id: 'read', name: 'Read last month\'s figures', desc: 'report-asg (as report-role) calls s3:GetObject through the gateway endpoint.', domain: 'secure', concepts: ['kms-key-policies', 'iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'asg', action: 's3:GetObject', resource: bucket, objectKey: 'monthly/2026-09.csv', expect: 'allow' }, requirementIds: ['r1'] },
    { id: 'write', name: 'Write the new report', desc: 'report-asg calls s3:PutObject; S3 asks KMS for a data key on its behalf.', domain: 'secure', concepts: ['kms-key-policies'], kind: 'iamAccess', params: { principal: 'asg', action: 's3:PutObject', resource: bucket, objectKey: 'monthly/2026-10.csv', expect: 'allow' }, requirementIds: ['r1'] },
    { id: 'outsider', name: 'Analyst opens a report', desc: 'The analyst user (S3 read access, no key access) tries to download a report from the office.', domain: 'secure', concepts: ['kms-key-policies', 'resource-vs-identity-policies'], kind: 'iamAccess', params: { principal: 'user:analyst', action: 's3:GetObject', resource: bucket, objectKey: 'monthly/2026-09.csv', context: { 'aws:SourceIp': '198.51.100.40' }, expect: 'deny' }, requirementIds: ['r2'] },
    { id: 'audit', name: 'Compliance check', desc: 'Finance data must be encrypted with the company-controlled key.', domain: 'secure', concepts: ['kms-key-policies', 'encryption-at-rest'], kind: 'audit', params: { rules: ['s3CustomerManagedKey', 's3BlockPublicAccess'] }, requirementIds: ['r3'] },
  ],
  incident: {
    alert: { title: 'Nightly report job: AccessDenied', detail: 'report-asg · GetObject and PutObject on finance-reports both fail · 0 reports written' },
    budget: 8,
    par: 3,
    logs: [
      {
        id: 'app',
        kind: 'app',
        title: 'Report job log (i-0c4f)',
        lines: [
          '03:00:02 INFO  fetching s3://finance-reports/monthly/2026-09.csv',
          '03:00:02 ERROR botocore.exceptions.ClientError: An error occurred (AccessDenied) when calling the GetObject operation: Access Denied',
          '03:00:03 INFO  ListObjectsV2 s3://finance-reports/monthly/ → 14 objects   # listing works fine',
        ],
      },
      {
        id: 'cloudtrail',
        kind: 'cloudtrail',
        title: 'CloudTrail (KMS events are management events, logged by default)',
        lines: [
          `03:00:02Z Decrypt  assumed-role/report-role/i-0c4f  sourceIPAddress: s3.amazonaws.com  key/${KEY_ID}  errorCode: AccessDenied`,
          `           errorMessage: User: arn:aws:sts::${ACCOUNT}:assumed-role/report-role/i-0c4f is not authorized to perform: kms:Decrypt on resource: arn:aws:kms:us-east-1:${ACCOUNT}:key/${KEY_ID} because no resource-based policy allows the kms:Decrypt action`,
          `2 days ago 15:20:44Z PutKeyPolicy  role/key-admin  key/${KEY_ID}  (statement "Enable IAM User Permissions" removed: ticket SEC-207 "least privilege on finance key")`,
        ],
      },
      {
        id: 'cloudwatch',
        kind: 'cloudwatch',
        title: 'CloudWatch metrics (finance-reports)',
        lines: ['4xxErrors  03:00–03:05  412', 'GetRequests 412 · PutRequests 0 · ListRequests 3', 'BucketSizeBytes unchanged'],
      },
    ],
    rootCause: `keypolicy:${KEY_ID}`,
    rootCauseExplain:
      "The bucket uses SSE-KMS with the finance key, so every GetObject makes S3 call kms:Decrypt (and every PutObject, kms:GenerateDataKey) as the caller. The key policy now only allows key-admin. Removing the 'Enable IAM User Permissions' statement (Principal: the account root) stopped IAM policies from counting at all, so report-role's permissions can't help. For KMS the key policy is required. Grant report-role kms:Decrypt and kms:GenerateDataKey in the key policy.",
    symptomEvents: ['read', 'write'],
    allowedChanges: [`keypolicy:${KEY_ID}`],
    wrongFixes: [
      { name: 'Give report-role kms:* in its IAM policy', board: start().rolePolicy('report-role', 'kms', doc({ Effect: 'Allow', Action: 'kms:*', Resource: '*' })).done(), expectFail: ['read', 'write'], collateral: true },
      { name: 'Switch the bucket to SSE-S3', board: start().config('finance-reports', { encryption: 'SSE-S3', kmsKeyId: null }).done(), expectFail: ['outsider', 'audit'], collateral: true },
      { name: 'Let any principal use the key', board: start().keyPolicy(KEY_ID, doc(admins, { Sid: 'Everyone', Effect: 'Allow', Principal: { AWS: '*' }, Action: ['kms:Decrypt', 'kms:GenerateDataKey'], Resource: '*' })).done(), expectFail: ['outsider'], collateral: true },
      {
        name: 'Restore "Enable IAM User Permissions" (delegate to IAM) without adding kms:Decrypt to the role',
        board: start().keyPolicy(KEY_ID, doc(admins, { Sid: 'Enable IAM User Permissions', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCOUNT}:root` }, Action: 'kms:*', Resource: '*' })).done(),
        expectFail: ['read', 'write'],
        collateral: false,
      },
    ],
  },
  questions: ['q-inc6-1', 'q-inc6-2', 'q-inc6-3'],
  concepts: ['kms-key-policies', 'resource-vs-identity-policies', 'iam-policy-evaluation', 'cloudtrail'],
  reference: start().keyPolicy(KEY_ID, doc(admins, { Sid: 'ReportFleetUse', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCOUNT}:role/report-role` }, Action: ['kms:Decrypt', 'kms:GenerateDataKey'], Resource: '*' })).done(),
  keywords: ['SSE-KMS', 'key policy', 'kms:Decrypt', 'no resource-based policy allows', 'customer managed key'],
  hints: ['Listing works, reading does not. What does reading an encrypted object need that listing does not?'],
};

