import type { Mission } from '../../engine/model';
import type { Statement } from '../../engine/iam/types';
import { BoardBuilder } from '../../engine/builder';
import { doc } from '../../engine/iam/policy';
import { ACCOUNT, incidentBase, prodLayout } from './shared';

const BUCKET = 'arn:aws:s3:::media-uploads';
const ec2Trust = doc({ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' });

function base(): BoardBuilder {
  return new BoardBuilder(prodLayout, 'helpful')
    .place('asg', 'app-a', { name: 'media-asg' })
    .config('media-asg', { min: 2, desired: 2, max: 4 })
    .place('s3', '', { name: 'media-uploads' })
    .place('vpce', 'vpc-prod', { name: 's3-endpoint' })
    .config('s3-endpoint', { routeTableIds: ['rtb-private-a', 'rtb-private-b'] })
    .role({ name: 'media-app-role', kind: 'role', trust: ec2Trust, policies: [{ name: 'media-objects', doc: doc({ Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject'], Resource: `${BUCKET}/*` }) }] })
    .role({ name: 'ops-team', kind: 'role', description: 'Assumed by the operations team through IAM Identity Center for console work', trust: doc({ Effect: 'Allow', Principal: { AWS: ACCOUNT }, Action: 'sts:AssumeRole' }), policies: [{ name: 'media-admin', doc: doc({ Effect: 'Allow', Action: 's3:*', Resource: [BUCKET, `${BUCKET}/*`] }) }] })
    .attachRole('media-asg', 'media-app-role');
}

const vpceId = base().id('s3-endpoint');

const denyOutsideVpce = (extra?: Statement['Condition']): Statement => ({
  Sid: 'DenyOutsideVpce',
  Effect: 'Deny',
  Principal: '*',
  Action: 's3:*',
  Resource: [BUCKET, `${BUCKET}/*`],
  Condition: { StringNotEquals: { 'aws:SourceVpce': vpceId }, ...(extra ?? {}) },
});

function start(): BoardBuilder {
  return base().resourcePolicy('media-uploads', doc(denyOutsideVpce()));
}

const startingBoard = start().done();
const b = start();
const bucket = b.id('media-uploads');

export const lockoutIncident: Mission = {
  ...incidentBase(),
  id: 'inc-lockout',
  title: 'Locked out by your own policy',
  client: 'Framewise, photo printing',
  users: 'The ops team, plus every customer upload',
  brief:
    "Yesterday security added a bucket policy so media-uploads can only be used from inside our VPC. Good idea: the app still works. But the ops team now gets 'Access Denied' uploading the new print templates in the S3 console, even though their role has s3:* on the bucket. Security is adamant: the bucket must stay locked to the VPC for everything else.",
  requirements: [
    { id: 'r1', text: 'The app keeps uploading through the VPC endpoint' },
    { id: 'r2', text: 'The ops team can upload from the console' },
    { id: 'r3', text: 'Anyone else outside the VPC is still denied, even with valid app credentials' },
  ],
  layout: prodLayout,
  startingBoard,
  events: [
    { id: 'app-upload', name: 'Customer photo upload', desc: 'media-asg (as media-app-role) calls s3:PutObject through the gateway endpoint.', domain: 'secure', concepts: ['vpc-endpoint-policies', 'iam-condition-keys'], kind: 'iamAccess', params: { principal: 'asg', action: 's3:PutObject', resource: bucket, objectKey: 'uploads/7781.jpg', expect: 'allow' }, requirementIds: ['r1'] },
    { id: 'team-upload', name: 'Ops uploads a template', desc: 'The ops-team role uploads from the S3 console in the office (198.51.100.23).', domain: 'secure', concepts: ['iam-policy-evaluation', 'iam-condition-keys'], kind: 'iamAccess', params: { principal: 'role:ops-team', action: 's3:PutObject', resource: bucket, objectKey: 'templates/a4-matte.json', context: { 'aws:SourceIp': '198.51.100.23' }, expect: 'allow' }, requirementIds: ['r2'] },
    { id: 'stolen-creds', name: 'Leaked app credentials', desc: "Someone copies media-app-role's temporary credentials off an instance and calls S3 from the internet (203.0.113.66).", domain: 'secure', concepts: ['iam-condition-keys', 'vpc-endpoint-policies'], kind: 'iamAccess', params: { principal: 'role:media-app-role', action: 's3:GetObject', resource: bucket, objectKey: 'uploads/7781.jpg', context: { 'aws:SourceIp': '203.0.113.66' }, expect: 'deny' }, requirementIds: ['r3'] },
  ],
  incident: {
    alert: { title: 'Ops team: Access Denied in the S3 console', detail: 'media-uploads · PutObject by role/ops-team · "explicit deny in a resource-based policy"' },
    budget: 6,
    par: 2,
    logs: [
      {
        id: 'cloudtrail',
        kind: 'cloudtrail',
        title: 'CloudTrail',
        lines: [
          `09:41:10Z PutObject  assumed-role/ops-team/dana  sourceIPAddress: 198.51.100.23  ${BUCKET}/templates/a4-matte.json  errorCode: AccessDenied`,
          `           errorMessage: User: arn:aws:sts::${ACCOUNT}:assumed-role/ops-team/dana is not authorized to perform: s3:PutObject on resource: "${BUCKET}/templates/a4-matte.json" with an explicit deny in a resource-based policy`,
          `09:41:12Z PutObject  assumed-role/media-app-role/i-0f12  vpcEndpointId: ${vpceId}  ${BUCKET}/uploads/7781.jpg  (success)`,
          'yesterday 17:05:33Z PutBucketPolicy  user/sec-lead-kim  media-uploads  ticket SEC-114 "restrict media bucket to VPC"',
        ],
      },
    ],
    rootCause: `resourcepolicy:${bucket}`,
    rootCauseExplain:
      "The bucket policy denies every s3 action unless aws:SourceVpce equals the gateway endpoint. Console uploads come from the office over the internet, so they carry no aws:SourceVpce at all; a missing key makes StringNotEquals true, and the Deny applies. An explicit deny beats the ops role's s3:* allow, so adding more Allows can never fix it. Narrow the Deny instead: add a second condition (for example ArnNotLike on aws:PrincipalArn for the ops-team role). Conditions are ANDed, so the deny then applies only to callers who are both outside the VPC and not the ops team.",
    symptomEvents: ['team-upload'],
    allowedChanges: [`resourcepolicy:${bucket}`],
    wrongFixes: [
      { name: 'Delete the bucket policy', board: start().resourcePolicy('media-uploads', null).done(), expectFail: ['stolen-creds'], collateral: true },
      {
        name: 'Add an Allow for ops-team to the bucket policy',
        board: start().resourcePolicy('media-uploads', doc(denyOutsideVpce(), { Sid: 'OpsTeam', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCOUNT}:role/ops-team` }, Action: 's3:*', Resource: [BUCKET, `${BUCKET}/*`] })).done(),
        expectFail: ['team-upload'],
        collateral: false,
      },
      {
        name: 'Exempt every principal in the account',
        board: start().resourcePolicy('media-uploads', doc(denyOutsideVpce({ StringNotEquals: { 'aws:SourceVpce': vpceId, 'aws:PrincipalAccount': ACCOUNT } }))).done(),
        expectFail: ['stolen-creds'],
        collateral: false,
      },
    ],
  },
  questions: ['q-inc7-1', 'q-inc7-2', 'q-inc7-3'],
  concepts: ['iam-condition-keys', 'iam-policy-evaluation', 'vpc-endpoint-policies', 'resource-vs-identity-policies'],
  reference: start().resourcePolicy('media-uploads', doc(denyOutsideVpce({ ArnNotLike: { 'aws:PrincipalArn': `arn:aws:iam::${ACCOUNT}:role/ops-team` } }))).done(),
  keywords: ['explicit deny', 'aws:SourceVpce', 'conditions are ANDed', 'missing condition key', 'restrict a bucket to a VPC endpoint'],
  hints: ['Allows cannot beat a Deny. When does this Deny apply, and who should it skip?'],
};
