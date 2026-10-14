// Section 4 (IAM & AWS CLI) and section 25 (IAM advanced).

import { BoardBuilder } from '../../engine/builder';
import { doc } from '../../engine/iam/policy';
import type { PolicyDocument } from '../../engine/iam/types';
import { inRegion, lab, publicVpc, regionOnly, usage0 } from './helpers';

const ACCOUNT = '111122223333';
const ec2Trust = doc({ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' });
const lambdaTrust = doc({ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' });

// =====================================================================================
// 4a. The report server that can't read its bucket (fix): the resource ARN is the bucket, not its objects.
// =====================================================================================

const reportsLayout = inRegion(publicVpc('vpc-reports', 40));
const REPORTS = 'arn:aws:s3:::quarterly-reports';

function reportServer(policy: PolicyDocument | null, attach = true): BoardBuilder {
  const b = new BoardBuilder(reportsLayout, 'bare')
    .place('ec2', 'public-a', { name: 'report-server' })
    .config('report-server', { publicIp: true })
    .place('s3', '', { name: 'quarterly-reports' })
    .place('s3', '', { name: 'payroll-exports' })
    .role({ name: 'report-server-role', kind: 'role', description: 'Instance profile for the report server', trust: ec2Trust, policies: policy ? [{ name: 'reports-read', doc: policy }] : [] });
  return attach ? b.attachRole('report-server', 'report-server-role') : b;
}

const readReports = doc({ Sid: 'ReadReports', Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: [REPORTS, `${REPORTS}/*`] });

export const reportServerLab = lab({
  id: 'c-iam-role',
  course: { section: 4, kind: 'fix', lectures: ['IAM Policies', 'IAM Policies Hands On', 'IAM Roles for AWS Services', 'IAM Roles Hands On', 'IAM Best Practices'] },
  title: "The server that can't read its bucket",
  client: 'Brindle & Co, an accounting firm',
  users: 'One EC2 instance that builds PDF reports from files in S3',
  brief:
    "Our report server gets AccessDenied every time it downloads a file from quarterly-reports, even though someone wrote it a policy for exactly that. A contractor suggested pasting an admin's access keys into the app config 'just to get it working'. Please don't. It must read the reports bucket, and nothing else: it has no business near payroll, and it never deletes anything.",
  requirements: [
    { id: 'r1', text: 'The report server can download files from quarterly-reports' },
    { id: 'r2', text: 'It cannot touch payroll-exports' },
    { id: 'r3', text: 'It cannot delete reports' },
  ],
  budget: 0,
  usage: usage0,
  defaults: 'bare',
  layout: reportsLayout,
  palette: ['ec2', 's3'],
  start: { board: reportServer(doc({ Sid: 'ReadReports', Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: REPORTS })).done(), fails: ['read'] },
  events: [
    { id: 'read', name: 'Download a report', desc: 'report-server (through its instance profile) calls s3:GetObject on quarterly-reports/2026-q3/summary.csv.', domain: 'secure', concepts: ['iam-roles', 'iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'ec2', action: 's3:GetObject', resource: '"quarterly-reports"', objectKey: '2026-q3/summary.csv', expect: 'allow', label: { principal: 'the report server', resource: 'the reports bucket' } }, requirementIds: ['r1'] },
    { id: 'payroll', name: 'Peek at payroll', desc: 'A bug (or an attacker on the box) calls s3:GetObject on payroll-exports.', domain: 'secure', concepts: ['iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'ec2', action: 's3:GetObject', resource: '"payroll-exports"', objectKey: 'oct.csv', expect: 'deny', label: { principal: 'the report server', resource: 'the payroll bucket' } }, requirementIds: ['r2'] },
    { id: 'delete', name: 'A cleanup script goes wrong', desc: 'report-server calls s3:DeleteObject on a report.', domain: 'secure', concepts: ['iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'ec2', action: 's3:DeleteObject', resource: '"quarterly-reports"', objectKey: '2026-q3/summary.csv', expect: 'deny', label: { principal: 'the report server', resource: 'the reports bucket' } }, requirementIds: ['r3'] },
  ],
  concepts: ['iam-roles', 'iam-policy-evaluation', 'resource-vs-identity-policies'],
  reference: reportServer(readReports).done(),
  mistakes: [
    { name: 'Allow s3:* on every bucket', board: reportServer(doc({ Effect: 'Allow', Action: 's3:*', Resource: '*' })).done(), expectFail: ['payroll', 'delete'] },
    { name: 'Right policy, role not attached to the instance', board: reportServer(readReports, false).done(), expectFail: ['read'] },
    { name: 'GetObject on objects only (no ListBucket)', board: reportServer(doc({ Effect: 'Allow', Action: 's3:*Object', Resource: `${REPORTS}/*` })).done(), expectFail: ['delete'] },
  ],
  keywords: ['application on EC2 needs AWS access → IAM role (instance profile), never access keys', 'object actions need the arn:...:bucket/* resource', 'least privilege', 'implicit deny'],
  hints: ['Open IAM and look at the resource the policy grants', 's3:GetObject acts on objects: arn:aws:s3:::bucket/*', 'ListBucket acts on the bucket ARN itself'],
  distractors: ['lambda', 'dynamodb', 'apigw'],
  decisions: [
    {
      title: 'An instance profile, not access keys',
      choice: 'report-server runs as report-server-role through its instance profile.',
      why: 'The role hands the instance short-lived credentials that rotate on their own. Access keys pasted into config leak in backups, AMIs and git history. On the exam, "application on EC2 needs to call AWS" always means an IAM role.',
      events: ['read'],
      components: ['report-server'],
      manual: ['iam-roles'],
    },
    {
      title: 'Read-only, on the object ARNs of one bucket',
      choice: 'The policy grants s3:GetObject on arn:aws:s3:::quarterly-reports/* and s3:ListBucket on the bucket ARN. No s3:*, no wildcard resource, no DeleteObject.',
      why: 'GetObject, PutObject and DeleteObject act on objects, whose ARNs end in /key: a statement whose only resource is the bucket ARN matches no object, so the call falls through to the implicit deny. And least privilege limits the blast radius of a bug or a compromised instance: anything not allowed is implicitly denied, so you only write the allows you need.',
      events: ['read', 'payroll', 'delete'],
      components: ['report-server-role'],
      manual: ['iam-policy-evaluation'],
    },
  ],
});

// =====================================================================================
// 4b. Too much power (fix): narrow an admin-style policy on a Lambda execution role.
// =====================================================================================

const TABLE = `arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/signups`;

function signups(policy: PolicyDocument, attach = true): BoardBuilder {
  const b = new BoardBuilder(regionOnly(), 'helpful')
    .place('apigw', '', { name: 'signup-api' })
    .place('lambda', '', { name: 'signup-fn' })
    .place('dynamodb', '', { name: 'signups' })
    .place('dynamodb', '', { name: 'billing' })
    .config('signup-api', { integration: { kind: 'lambda', targetId: 'signup-fn' } })
    .role({ name: 'signup-fn-role', kind: 'role', description: 'Execution role for signup-fn', trust: lambdaTrust, policies: [{ name: 'signup-access', doc: policy }] });
  return attach ? b.attachRole('signup-fn', 'signup-fn-role') : b;
}

const signupLeast = doc({ Sid: 'SignupsTable', Effect: 'Allow', Action: ['dynamodb:PutItem', 'dynamodb:GetItem'], Resource: TABLE });

export const tooMuchPowerLab = lab({
  id: 'c-iam-least',
  course: { section: 4, kind: 'fix', lectures: ['IAM Policies', 'IAM Policies Hands On', 'IAM Security Tools', 'IAM Best Practices'] },
  title: 'Too much power',
  client: 'Kestrel Fitness, a gym chain',
  users: 'A sign-up form that writes new members into a DynamoDB table',
  brief:
    "Our sign-up function works, but IAM Access Analyzer flagged its role: an intern gave it dynamodb:* on every table 'so it would stop failing'. The function only saves a new member and reads them back. It must keep working, but it should never be able to touch billing or drop a table.",
  requirements: [
    { id: 'r1', text: 'signup-fn can save and read members in signups' },
    { id: 'r2', text: 'It cannot read or write billing' },
    { id: 'r3', text: 'It cannot delete tables' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['apigw', 'lambda', 'dynamodb'],
  start: { board: signups(doc({ Sid: 'Everything', Effect: 'Allow', Action: 'dynamodb:*', Resource: '*' })).done(), fails: ['billing', 'drop'] },
  events: [
    { id: 'save', name: 'Save a new member', desc: 'signup-fn calls dynamodb:PutItem on signups.', domain: 'secure', concepts: ['iam-policy-evaluation', 'iam-roles'], kind: 'iamAccess', params: { principal: 'lambda', action: 'dynamodb:PutItem', resource: '"signups"', expect: 'allow', label: { principal: 'the sign-up function', resource: 'the signups table' } }, requirementIds: ['r1'] },
    { id: 'read', name: 'Read the member back', desc: 'signup-fn calls dynamodb:GetItem on signups.', domain: 'secure', concepts: ['iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'lambda', action: 'dynamodb:GetItem', resource: '"signups"', expect: 'allow', label: { principal: 'the sign-up function', resource: 'the signups table' } }, requirementIds: ['r1'] },
    { id: 'billing', name: 'Scan the billing table', desc: 'A code-injection bug makes signup-fn call dynamodb:Scan on billing.', domain: 'secure', concepts: ['iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'lambda', action: 'dynamodb:Scan', resource: '"billing"', expect: 'deny', label: { principal: 'the sign-up function', resource: 'the billing table' } }, requirementIds: ['r2'] },
    { id: 'drop', name: 'DeleteTable', desc: 'The same bug calls dynamodb:DeleteTable on signups.', domain: 'secure', concepts: ['iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'lambda', action: 'dynamodb:DeleteTable', resource: '"signups"', expect: 'deny', label: { principal: 'the sign-up function', resource: 'the signups table' } }, requirementIds: ['r3'] },
  ],
  concepts: ['iam-policy-evaluation', 'iam-roles', 'cloudtrail'],
  reference: signups(signupLeast).done(),
  mistakes: [
    { name: 'dynamodb:* on the signups table only', board: signups(doc({ Effect: 'Allow', Action: 'dynamodb:*', Resource: TABLE })).done(), expectFail: ['drop'] },
    { name: 'PutItem and GetItem on every table', board: signups(doc({ Effect: 'Allow', Action: ['dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:Scan'], Resource: '*' })).done(), expectFail: ['billing'] },
    { name: 'Write-only (forgot GetItem)', board: signups(doc({ Effect: 'Allow', Action: 'dynamodb:PutItem', Resource: TABLE })).done(), expectFail: ['read'] },
  ],
  keywords: ['least privilege', 'IAM Access Analyzer / last accessed information → remove unused permissions', 'scope Resource to the table ARN', 'never Action "*" on Resource "*"'],
  hints: ['Open signup-fn-role in IAM', 'List the two actions the function really calls', 'Scope the resource to the signups table ARN'],
  distractors: ['s3', 'sqs', 'cloudfront'],
  decisions: [
    {
      title: 'The function runs as its own execution role',
      choice: 'signup-fn-role is attached to signup-fn and trusted only by lambda.amazonaws.com.',
      why: 'Lambda assumes the execution role on every invocation and hands the code temporary credentials. One role per function keeps each function\'s permissions separate, so narrowing one never breaks another.',
      events: ['save', 'read'],
      components: ['signup-fn'],
      manual: ['iam-roles'],
    },
    {
      title: 'Exactly the actions the code calls, on one table',
      choice: `dynamodb:PutItem and dynamodb:GetItem on ${TABLE}, nothing else.`,
      why: 'IAM last-accessed data and Access Analyzer show which actions a role really uses; everything else is risk without benefit. DeleteTable and Scan never appear in the code, so they never appear in the policy. A wildcard resource would turn a bug in one function into access to every table, billing included.',
      events: ['save', 'read', 'billing', 'drop'],
      components: ['signup-fn-role'],
      manual: ['iam-policy-evaluation'],
    },
  ],
});

// =====================================================================================
// 25a. Guardrails for the dev account (fix): an SCP denies too much; a boundary caps a powerful role.
// =====================================================================================

const scpDenyOutsideRegion = (exceptGlobal: boolean) =>
  doc({
    Sid: 'DenyOutsideEuWest1',
    Effect: 'Deny',
    ...(exceptGlobal ? { NotAction: ['iam:*', 'sts:*', 'organizations:*'] } : { Action: '*' }),
    Resource: '*',
    Condition: { StringNotEquals: { 'aws:RequestedRegion': 'eu-west-1' } },
  });

const euLayout = regionOnly('eu-west-1', 'Europe (Ireland)');

function devAccount(scp: PolicyDocument | null, boundary: PolicyDocument | null): BoardBuilder {
  return new BoardBuilder(euLayout, 'helpful')
    .place('s3', '', { name: 'dev-data' })
    .place('dynamodb', '', { name: 'dev-sessions' })
    .iam({ orgId: 'o-dev123', scps: [{ name: 'FullAWSAccess', doc: doc({ Effect: 'Allow', Action: '*', Resource: '*' }) }, ...(scp ? [{ name: 'region-guardrail', doc: scp }] : [])] })
    .role({ name: 'developer', kind: 'role', description: 'Developers assume this through IAM Identity Center', trust: doc({ Effect: 'Allow', Principal: { AWS: ACCOUNT }, Action: 'sts:AssumeRole' }), policies: [{ name: 'power-user', doc: doc({ Effect: 'Allow', NotAction: ['organizations:*', 'account:*'], Resource: '*' }) }] })
    .role({ name: 'ci-deployer', kind: 'role', description: 'The CI pipeline deploys app stacks with this role', trust: doc({ Effect: 'Allow', Principal: { AWS: ACCOUNT }, Action: 'sts:AssumeRole' }), policies: [{ name: 'admin', doc: doc({ Effect: 'Allow', Action: '*', Resource: '*' }) }], boundary });
}

const appBoundary = doc({ Sid: 'AppServicesOnly', Effect: 'Allow', Action: ['s3:*', 'dynamodb:*', 'lambda:*', 'cloudformation:*'], Resource: '*' });

export const guardrailsLab = lab({
  id: 'c-iam-guardrails',
  course: { section: 25, kind: 'fix', lectures: ['Organizations - Overview', 'IAM - Advanced Policies', 'IAM - Policy Evaluation Logic', 'AWS IAM Identity Center'] },
  title: 'Guardrails that block the builders',
  client: 'Quillmark, a publishing platform team',
  users: 'Developers and a CI pipeline in a dev account inside AWS Organizations',
  brief:
    "Our data must stay in the EU, so security attached an SCP to the dev OU that denies every request outside eu-west-1. Since then developers can't even switch roles: STS's global endpoint and IAM are served from us-east-1, so the SCP denies them. Separately, the CI pipeline's role is full admin, and a compromised build must never be able to hop into other roles. Keep the Region guardrail, fix the lockout, and cap the pipeline without rewriting its policy.",
  requirements: [
    { id: 'r1', text: 'Developers can work with S3 and DynamoDB in eu-west-1' },
    { id: 'r2', text: 'Developers can still use IAM and STS (global services)' },
    { id: 'r3', text: 'Nobody can use services in other Regions' },
    { id: 'r4', text: 'The CI role can deploy app resources but can never assume other roles' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['s3', 'dynamodb'],
  start: { board: devAccount(scpDenyOutsideRegion(false), null).done(), fails: ['assume'] },
  events: [
    { id: 'work', name: 'Developer writes test data', desc: 'The developer role calls s3:PutObject on dev-data in eu-west-1.', domain: 'secure', concepts: ['scps', 'iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'role:developer', action: 's3:PutObject', resource: '"dev-data"', objectKey: 'fixtures/users.json', context: { 'aws:RequestedRegion': 'eu-west-1' }, expect: 'allow', label: { resource: 'the dev-data bucket' } }, requirementIds: ['r1'] },
    { id: 'assume', name: 'Developer switches role', desc: 'A developer assumes ci-deployer to debug a failed deploy, through the global STS endpoint (us-east-1).', domain: 'secure', concepts: ['scps', 'iam-condition-keys'], kind: 'iamAccess', params: { principal: 'role:developer', action: 'sts:AssumeRole', resource: 'role:ci-deployer', context: { 'aws:RequestedRegion': 'us-east-1' }, expect: 'allow' }, requirementIds: ['r2'] },
    { id: 'other-region', name: 'Launch in us-west-2', desc: 'A developer tries dynamodb:CreateTable in us-west-2, outside the EU.', domain: 'secure', concepts: ['scps', 'iam-condition-keys'], kind: 'iamAccess', params: { principal: 'role:developer', action: 'dynamodb:CreateTable', resource: '"dev-sessions"', context: { 'aws:RequestedRegion': 'us-west-2' }, expect: 'deny', label: { resource: 'a DynamoDB table' } }, requirementIds: ['r3'] },
    { id: 'ci-deploy', name: 'Pipeline deploys', desc: 'ci-deployer calls dynamodb:UpdateTable on dev-sessions in eu-west-1.', domain: 'secure', concepts: ['permissions-boundaries'], kind: 'iamAccess', params: { principal: 'role:ci-deployer', action: 'dynamodb:UpdateTable', resource: '"dev-sessions"', context: { 'aws:RequestedRegion': 'eu-west-1' }, expect: 'allow', label: { resource: 'the dev-sessions table' } }, requirementIds: ['r4'] },
    { id: 'ci-iam', name: 'Pipeline hops into another role', desc: 'A compromised build step makes ci-deployer call sts:AssumeRole on the developer role.', domain: 'secure', concepts: ['permissions-boundaries', 'iam-policy-evaluation'], kind: 'iamAccess', params: { principal: 'role:ci-deployer', action: 'sts:AssumeRole', resource: 'role:developer', context: { 'aws:RequestedRegion': 'us-east-1' }, expect: 'deny' }, requirementIds: ['r4'] },
  ],
  concepts: ['scps', 'permissions-boundaries', 'iam-policy-evaluation', 'iam-condition-keys', 'aws-organizations'],
  reference: devAccount(scpDenyOutsideRegion(true), appBoundary).done(),
  mistakes: [
    { name: 'Remove the SCP', board: devAccount(null, appBoundary).done(), expectFail: ['other-region'] },
    { name: 'Exempt global services, no boundary on CI', board: devAccount(scpDenyOutsideRegion(true), null).done(), expectFail: ['ci-iam'] },
    { name: 'Boundary that also allows sts:*', board: devAccount(scpDenyOutsideRegion(true), doc({ Effect: 'Allow', Action: ['s3:*', 'dynamodb:*', 'sts:*'], Resource: '*' })).done(), expectFail: ['ci-iam'] },
  ],
  keywords: ['restrict Regions across accounts → SCP with aws:RequestedRegion', 'exempt global services (IAM, STS, Organizations) with NotAction', 'SCPs and boundaries never grant, they only limit', 'delegate admin safely, prevent privilege escalation → permissions boundary'],
  hints: ['Open the SCPs in IAM: what does the Region deny catch?', 'Global services need an exemption: NotAction', 'A permissions boundary on ci-deployer caps what its admin policy can do'],
  distractors: ['lambda', 'apigw', 'sqs'],
  decisions: [
    {
      title: 'Exempt global services from the Region deny',
      choice: 'The SCP denies everything except IAM, STS and Organizations (NotAction) when aws:RequestedRegion is not eu-west-1.',
      why: 'Global services such as IAM are served from us-east-1, so a blanket Region deny locks people out of IAM and role switching. AWS\'s own example SCP exempts them with NotAction. The guardrail still stops everything regional elsewhere.',
      events: ['assume', 'other-region', 'work'],
      components: ['SCPs'],
      manual: ['scps', 'iam-condition-keys'],
    },
    {
      title: 'A permissions boundary on the pipeline',
      choice: 'ci-deployer keeps its admin policy, capped by a boundary that allows only S3, DynamoDB, Lambda and CloudFormation.',
      why: 'Effective permissions are the intersection of the identity policy and the boundary, so sts:AssumeRole is implicitly denied however broad the role\'s own policy is. That is how you delegate "admin for app resources" without handing out IAM or a way to escalate.',
      events: ['ci-iam', 'ci-deploy'],
      components: ['ci-deployer'],
      manual: ['permissions-boundaries'],
    },
  ],
});
