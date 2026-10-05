import type { Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

const layout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  vpc: {
    id: 'vpc-northwind',
    cidr: '10.20.0.0/16',
    igw: true,
    azs: [
      { id: 'us-east-1a', name: 'us-east-1a' },
      { id: 'us-east-1b', name: 'us-east-1b' },
    ],
    routeTables: [
      { id: 'rtb-public', name: 'rtb-public', routes: [{ dest: '0.0.0.0/0', target: { igw: 'igw-1' } }] },
      { id: 'rtb-batch-a', name: 'rtb-batch-a', routes: [] },
      { id: 'rtb-batch-b', name: 'rtb-batch-b', routes: [] },
    ],
    subnets: [
      { id: 'public-a', name: 'public-a', cidr: '10.20.0.0/24', az: 'us-east-1a', tier: 'public', routeTableId: 'rtb-public' },
      { id: 'public-b', name: 'public-b', cidr: '10.20.1.0/24', az: 'us-east-1b', tier: 'public', routeTableId: 'rtb-public' },
      { id: 'batch-a', name: 'batch-a', cidr: '10.20.10.0/24', az: 'us-east-1a', tier: 'batch', routeTableId: 'rtb-batch-a' },
      { id: 'batch-b', name: 'batch-b', cidr: '10.20.11.0/24', az: 'us-east-1b', tier: 'batch', routeTableId: 'rtb-batch-b' },
    ],
  },
};

function reference(): BoardBuilder {
  return new BoardBuilder(layout, 'bare')
    .place('nat', 'public-a', { name: 'nat-a' })
    .place('nat', 'public-b', { name: 'nat-b' })
    .route('rtb-batch-a', '0.0.0.0/0', { natName: 'nat-a' })
    .route('rtb-batch-b', '0.0.0.0/0', { natName: 'nat-b' })
    .place('asg', 'batch-a', { name: 'batch-fleet' })
    .config('batch-fleet', { instanceType: 'c5.large', min: 4, desired: 4, max: 8, policy: { kind: 'none' } })
    .place('s3', '', { name: 'scan-archive' })
    .place('vpce', 'vpc-northwind', { name: 's3-endpoint' })
    .config('s3-endpoint', { routeTableIds: ['rtb-batch-a', 'rtb-batch-b'] });
}

export const northwind: Mission = {
  id: 'northwind',
  stage: 1,
  mode: 'build',
  title: 'The mystery line item',
  client: 'Northwind Imaging, medical scan analytics',
  users: 'An overnight batch fleet that reads 20 TB of scans from S3 every month',
  brief:
    "Our AWS bill has a line called 'NAT Gateway' that's bigger than our servers. Nobody knows why. The batch fleet runs in private subnets in two AZs, pulls scans from our S3 bucket all night and downloads OS patches. Security says the fleet must stay private. Finance says get the bill under $600 or we move back on-prem.",
  requirements: [
    { id: 'r1', text: 'Every batch server reads from S3 without leaving the AWS network' },
    { id: 'r2', text: 'Batch servers can still download patches from the internet' },
    { id: 'r3', text: 'The fleet stays private and the bucket stays locked down' },
    { id: 'r4', text: 'Monthly bill under $600', target: { budget: 600 } },
  ],
  budget: 600,
  usage: {
    requestsPerMonth: 0,
    dataOutGb: 0,
    s3StorageGb: 5000,
    s3GetRequests: 20_000_000,
    s3PutRequests: 200_000,
    flows: [
      { from: 'asg', to: 'svc:s3', gbPerMonth: 20000 },
      { from: 'asg', to: 'internet', gbPerMonth: 50 },
    ],
  },
  defaults: 'bare',
  layout,
  palette: ['asg', 'ec2', 'nat', 'vpce', 's3'],
  events: [
    { id: 's3-path', name: 'Nightly scan reads', desc: 'Every batch server reads scans from S3. The path must use the gateway endpoint in both AZs.', domain: 'cost', concepts: ['vpc-gateway-endpoints', 'nat-data-processing'], kind: 'reachability', params: { from: 'asg', to: 'svc:s3', port: 443, expect: 'allow', expectVia: 'vpce', label: { from: 'a batch fleet (Auto Scaling group)' } }, requirementIds: ['r1'] },
    { id: 'patch', name: 'Patch downloads', desc: 'Batch servers fetch OS updates over HTTPS.', domain: 'secure', concepts: ['nat-gateway', 'vpc-public-private'], kind: 'reachability', params: { from: 'asg', to: 'internet', port: 443, expect: 'allow', label: { from: 'a batch fleet (Auto Scaling group)' } }, requirementIds: ['r2'] },
    { id: 'audit', name: 'Security audit', desc: 'The fleet must be private and the bucket locked down.', domain: 'secure', concepts: ['vpc-public-private', 's3-block-public-access'], kind: 'audit', params: { rules: ['appTierPrivate', 's3BlockPublicAccess', 'noSshFromWorld'] }, requirementIds: ['r3'] },
    { id: 'bill', name: 'Monthly bill', desc: '20 TB from S3 and 50 GB of patches per month, priced along the real network path.', domain: 'cost', concepts: ['nat-data-processing', 'vpc-gateway-endpoints', 'data-transfer-costs'], kind: 'bill', params: {}, requirementIds: ['r4'], passesOnEmptyBoard: true },
  ],
  questions: ['q-nw-1', 'q-nw-2', 'q-nw-3', 'q-nw-4', 'q-nw-5'],
  concepts: ['vpc-gateway-endpoints', 'nat-data-processing', 'nat-gateway', 'vpc-public-private', 'data-transfer-costs', 's3-block-public-access', 'internet-gateway'],
  reference: reference().done(),
  mistakes: [
    { name: 'No gateway endpoint (S3 through the NAT)', board: reference().remove('s3-endpoint').done(), expectFail: ['s3-path', 'bill'] },
    { name: 'Endpoint associated with only one route table', board: reference().config('s3-endpoint', { routeTableIds: ['rtb-batch-a'] }).done(), expectFail: ['s3-path', 'bill'] },
    { name: 'No NAT route (endpoint only)', board: reference().removeRoute('rtb-batch-a', '0.0.0.0/0').removeRoute('rtb-batch-b', '0.0.0.0/0').done(), expectFail: ['patch'] },
    { name: 'Fleet in public subnets with public IPs', board: reference().subnets('batch-fleet', ['public-a', 'public-b']).config('batch-fleet', { publicIp: true }).done(), expectFail: ['s3-path', 'audit'] },
  ],
  keywords: ['reduce data transfer cost', 'private subnet access to S3 / DynamoDB → gateway endpoint (free)', 'NAT gateway charges per GB', 'without traversing the internet'],
  hints: ['NAT gateways for patch traffic', 'Routes from the batch subnets', 'A gateway endpoint for S3, associated with the right route tables'],
};
