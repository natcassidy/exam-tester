// Section 26 (security and encryption) and section 27 (networking: VPC).

import type { NaclRule, VpcLayout, VpcSpec } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import { inRegion, lab, threeTierVpc, usage0 } from './helpers';

// =====================================================================================
// 26a. The pen-test report (fix): WAF on the load balancer, no SSH from the world, encrypted database.
// =====================================================================================

const penLayout = inRegion(threeTierVpc('vpc-pen', 95));

function clinic(): BoardBuilder {
  return new BoardBuilder(penLayout, 'helpful')
    .place('alb', 'public-a', { name: 'portal-alb' })
    .place('asg', 'app-a', { name: 'portal-asg' })
    .config('portal-asg', { min: 2, desired: 2, max: 6, healthCheckType: 'ELB', policy: { kind: 'targetTracking', targetCpu: 50 } })
    .place('rds', 'data-a', { name: 'patients-db' })
    .config('patients-db', { multiAz: true, storageEncrypted: true, backupRetentionDays: 7 })
    .place('waf', '', { name: 'portal-acl' })
    .config('portal-acl', { managedRules: true, rateLimitPer5Min: 2000, associatedId: null });
}
const hardened = () => clinic().config('portal-acl', { associatedId: 'portal-alb' });
const sshOpen = (b: BoardBuilder) => b.sgRule('portal-asg', 'inbound', { protocol: 'tcp', fromPort: 22, toPort: 22, source: { cidr: '0.0.0.0/0' }, description: 'vendor support' });

export const pentestLab = lab({
  id: 'c-sec-pentest',
  course: { section: 26, kind: 'fix', lectures: ['AWS WAF', 'AWS Shield', 'KMS Overview', 'Firewall Manager', 'Amazon GuardDuty'] },
  title: 'The pen-test report',
  client: 'Larkspur Clinics, a patient portal',
  users: 'Patients booking appointments and reading test results',
  brief:
    "A penetration test came back with three findings. One: the web ACL we bought exists but protects nothing since we rebuilt the load balancer. Two: a vendor left SSH open to the world on the portal servers. Three: the patients database is not encrypted at rest. Fix all three without taking the portal down.",
  requirements: [
    { id: 'r1', text: 'Patients still reach the portal' },
    { id: 'r2', text: 'The public entry point is behind AWS WAF' },
    { id: 'r3', text: 'No SSH from the internet; only the app tier reaches the database' },
    { id: 'r4', text: 'Patient data encrypted at rest' },
  ],
  budget: 0,
  usage: usage0,
  layout: penLayout,
  palette: ['alb', 'asg', 'rds', 'waf', 'cloudfront'],
  start: { board: sshOpen(clinic()).config('patients-db', { storageEncrypted: false }).done(), fails: ['waf', 'access', 'encryption'] },
  events: [
    { id: 'reach', name: 'A patient logs in', desc: 'HTTPS from the internet to the portal.', domain: 'resilient', concepts: ['alb'], kind: 'reachability', params: { from: 'internet', to: 'alb', port: 443, expect: 'allow', label: { to: 'the portal' } }, requirementIds: ['r1'] },
    { id: 'waf', name: 'Finding 1: web filtering', desc: 'Every internet-facing entry point must have a web ACL.', domain: 'secure', concepts: ['aws-waf'], kind: 'audit', params: { rules: ['wafOnPublicEntry'] }, requirementIds: ['r2'] },
    { id: 'access', name: 'Finding 2: network access', desc: 'No SSH from 0.0.0.0/0; the database accepts only the app tier.', domain: 'secure', concepts: ['security-groups', 'sg-chaining'], kind: 'audit', params: { rules: ['noSshFromWorld', 'dbSgLeastPrivilege'] }, requirementIds: ['r3'] },
    { id: 'encryption', name: 'Finding 3: encryption', desc: 'Every data store encrypted at rest.', domain: 'secure', concepts: ['encryption-at-rest'], kind: 'audit', params: { rules: ['encryptionAtRest'] }, requirementIds: ['r4'] },
  ],
  concepts: ['aws-waf', 'security-groups', 'encryption-at-rest', 'security-services'],
  reference: hardened().done(),
  mistakes: [
    { name: 'WAF associated, SSH still open', board: sshOpen(hardened()).done(), expectFail: ['access'] },
    { name: 'Everything but the database encryption', board: hardened().config('patients-db', { storageEncrypted: false }).done(), expectFail: ['encryption'] },
  ],
  keywords: ['SQL injection, XSS, bad bots, rate limiting → AWS WAF on ALB, API Gateway or CloudFront', 'DDoS → Shield (Advanced for 24/7 response team)', 'admin access → Session Manager instead of SSH from 0.0.0.0/0', 'encrypt an existing RDS instance: snapshot → encrypted copy → restore'],
  hints: ['A web ACL only protects what it is associated with', 'Look at portal-asg\'s inbound rules', 'The database has a storage encryption setting'],
  distractors: ['nat', 'vpce', 's3'],
  whyNot: { cloudfront: 'CloudFront could carry the web ACL too, but the portal has no global audience and the existing ACL can attach to the load balancer directly.' },
  decisions: [
    {
      title: 'Attach the web ACL to the load balancer',
      choice: 'portal-acl (managed rules plus a rate limit) is associated with portal-alb.',
      why: 'A web ACL does nothing until it is associated with an ALB, API Gateway stage, AppSync API or CloudFront distribution. Rebuilding the load balancer silently dropped the association.',
      events: ['reach', 'waf'],
      components: ['portal-acl'],
      manual: ['aws-waf'],
    },
    {
      title: 'No SSH from the world',
      choice: 'portal-asg\'s group accepts only HTTPS from the load balancer\'s group.',
      why: 'Support staff use Systems Manager Session Manager: no inbound port, every session logged. An SSH rule open to 0.0.0.0/0 is the most common finding in any audit.',
      events: ['access'],
      components: ['portal-asg'],
      manual: ['security-groups'],
    },
    {
      title: 'Encrypt the database',
      choice: 'patients-db has storage encryption on (KMS).',
      why: 'Encryption is set when the instance is created. For an existing database: take a snapshot, copy it with encryption on, restore from the copy and switch the endpoint.',
      events: ['encryption'],
      components: ['patients-db'],
      manual: ['encryption-at-rest'],
    },
  ],
});

// =====================================================================================
// 27a. A VPC from scratch (finish, bare): IGW, public and private routes, a NAT gateway.
// =====================================================================================

function emptyVpc(): VpcSpec {
  return {
    id: 'vpc-scratch',
    name: 'scratch',
    cidr: '10.100.0.0/16',
    azs: [
      { id: 'us-east-1a', name: 'us-east-1a' },
      { id: 'us-east-1b', name: 'us-east-1b' },
    ],
    routeTables: [
      { id: 'rtb-public', name: 'rtb-public', routes: [] },
      { id: 'rtb-private', name: 'rtb-private', routes: [] },
    ],
    subnets: [
      { id: 'public-a', name: 'public-a', cidr: '10.100.0.0/24', az: 'us-east-1a', tier: 'public', routeTableId: 'rtb-public' },
      { id: 'public-b', name: 'public-b', cidr: '10.100.1.0/24', az: 'us-east-1b', tier: 'public', routeTableId: 'rtb-public' },
      { id: 'private-a', name: 'private-a', cidr: '10.100.10.0/24', az: 'us-east-1a', tier: 'app', routeTableId: 'rtb-private' },
      { id: 'private-b', name: 'private-b', cidr: '10.100.11.0/24', az: 'us-east-1b', tier: 'app', routeTableId: 'rtb-private' },
    ],
  };
}
const scratchLayout: VpcLayout = inRegion(emptyVpc());

function servers(): BoardBuilder {
  return new BoardBuilder(scratchLayout, 'bare')
    .place('ec2', 'public-a', { name: 'web' })
    .config('web', { publicIp: true })
    .sgRule('web', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } })
    .sgRule('web', 'outbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } })
    .place('ec2', 'private-a', { name: 'worker' })
    .sgRule('worker', 'outbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } });
}
const igw = (b: BoardBuilder) => b.place('igw', 'vpc-scratch', { name: 'scratch-igw' }).route('rtb-public', '0.0.0.0/0', { igwName: 'scratch-igw' });
const nat = (b: BoardBuilder) => b.place('nat', 'public-a', { name: 'scratch-nat' }).route('rtb-private', '0.0.0.0/0', { natName: 'scratch-nat' });

export const vpcBuildLab = lab({
  id: 'c-vpc-build',
  course: { section: 27, kind: 'finish', lectures: ['Internet Gateways & Route Tables', 'NAT Gateways', 'Bastion Hosts', 'VPC - Section Summary'] },
  title: 'A VPC from scratch',
  client: 'Pelican Print, an online print shop',
  users: 'A public web server and a private worker that downloads fonts and print profiles',
  brief:
    "Our VPC has subnets and two servers, and nothing else: no way in, no way out. The web server must be reachable on HTTPS from the internet. The worker in the private subnet must download updates from the internet over HTTPS, but nothing on the internet may ever connect to it. Defaults are bare here: you wire every gateway and route yourself. Click a subnet's name to open its route table.",
  requirements: [
    { id: 'r1', text: 'Customers reach the web server on 443' },
    { id: 'r2', text: 'The worker can download from the internet' },
    { id: 'r3', text: 'Nothing on the internet can reach the worker' },
  ],
  budget: 0,
  usage: usage0,
  defaults: 'bare',
  layout: scratchLayout,
  palette: ['ec2', 'igw', 'nat', 'vpce'],
  start: { board: servers().done(), fails: ['web', 'updates'] },
  events: [
    { id: 'web', name: 'A customer opens the shop', desc: 'HTTPS from the internet to the web server.', domain: 'secure', concepts: ['internet-gateway', 'vpc-public-private'], kind: 'reachability', params: { from: 'internet', to: '"web"', port: 443, expect: 'allow', label: { to: 'the web server' } }, requirementIds: ['r1'] },
    { id: 'updates', name: 'The worker fetches fonts', desc: 'The worker opens HTTPS to a font server on the internet.', domain: 'secure', concepts: ['nat-gateway'], kind: 'reachability', params: { from: '"worker"', to: 'internet', port: 443, expect: 'allow', expectVia: 'nat', label: { from: 'the worker', to: 'the internet' } }, requirementIds: ['r2'] },
    { id: 'probe', name: 'A scanner probes the worker', desc: 'Someone on the internet tries to connect to the worker on 443.', domain: 'secure', concepts: ['vpc-public-private'], kind: 'reachability', params: { from: 'internet', to: '"worker"', port: 443, expect: 'deny', label: { to: 'the worker' } }, requirementIds: ['r3'] },
  ],
  concepts: ['internet-gateway', 'nat-gateway', 'vpc-public-private'],
  reference: nat(igw(servers())).done(),
  mistakes: [
    { name: 'Internet gateway, no NAT', board: igw(servers()).done(), expectFail: ['updates'] },
    { name: 'Private subnet routed straight to the internet gateway', board: igw(servers()).route('rtb-private', '0.0.0.0/0', { igwName: 'scratch-igw' }).done(), expectFail: ['updates'] },
    { name: 'NAT gateway placed, private route table left empty', board: igw(servers()).place('nat', 'public-a', { name: 'scratch-nat' }).done(), expectFail: ['updates'] },
  ],
  keywords: ['public subnet = route table with 0.0.0.0/0 → internet gateway', 'private instances reach the internet through a NAT gateway in a public subnet', 'NAT gateway is AZ-scoped and needs an IGW route', 'NAT gateways allow outbound only'],
  hints: ['A gateway that attaches the VPC to the internet', 'Click public-a\'s name to open rtb-public, and add 0.0.0.0/0 → the internet gateway. Only then is the subnet public', 'Outbound-only internet for the private subnet: a NAT gateway in a public subnet, and a 0.0.0.0/0 route to it in rtb-private'],
  distractors: ['alb', 'rds', 's3'],
  whyNot: { vpce: 'A gateway endpoint reaches S3 and DynamoDB privately. The worker downloads from a third-party server on the internet, which needs NAT.' },
  decisions: [
    {
      title: 'An internet gateway and a public route table',
      choice: 'scratch-igw is attached to the VPC, and rtb-public sends 0.0.0.0/0 to it.',
      why: 'A subnet is public only because its route table sends internet traffic to an internet gateway. The web server also needs a public IP and a security group that allows 443.',
      events: ['web'],
      components: ['scratch-igw', 'rtb-public'],
      manual: ['internet-gateway', 'vpc-public-private'],
    },
    {
      title: 'A NAT gateway for outbound-only access',
      choice: 'scratch-nat sits in public-a, and rtb-private sends 0.0.0.0/0 to it.',
      why: 'The NAT gateway translates the worker\'s private address for outbound connections and drops anything that starts on the internet. It must live in a public subnet so its own traffic can reach the internet gateway. For HA, one NAT gateway per AZ.',
      events: ['updates', 'probe'],
      components: ['scratch-nat', 'rtb-private'],
      manual: ['nat-gateway'],
    },
  ],
});

// =====================================================================================
// 27b. Stateless means both ways (fix): NACL ephemeral ports.
// =====================================================================================

const naclLayout = inRegion(threeTierVpc('vpc-nacl', 110, ['app']));
const rule = (ruleNumber: number, portRange: [number, number], cidr: string, action: 'allow' | 'deny' = 'allow'): NaclRule => ({ ruleNumber, protocol: 'tcp', portRange, cidr, action });

function hardenedSubnets(outbound: NaclRule[]): BoardBuilder {
  const b = new BoardBuilder(naclLayout, 'helpful')
    .place('alb', 'public-a', { name: 'store-alb' })
    .place('asg', 'app-a', { name: 'store-asg' })
    .config('store-asg', { min: 2, desired: 2, max: 6, healthCheckType: 'ELB' })
    .nacl('acl-public', 'public-nacl', 'vpc-nacl')
    .naclRule('acl-public', 'inbound', rule(100, [443, 443], '0.0.0.0/0'))
    .naclRule('acl-public', 'inbound', rule(110, [1024, 65535], '10.110.0.0/16'));
  for (const r of outbound) b.naclRule('acl-public', 'outbound', r);
  return b.associate('public-a', 'naclId', 'acl-public').associate('public-b', 'naclId', 'acl-public');
}
const toApp = rule(100, [443, 443], '10.110.0.0/16');
const ephemeral = rule(110, [1024, 65535], '0.0.0.0/0');

export const naclLab = lab({
  id: 'c-vpc-nacl',
  course: { section: 27, kind: 'fix', lectures: ['NACL & Security Groups', 'NACL & Security Groups Hands On', 'VPC Flow Logs', 'VPC Reachability Analyzer'] },
  title: 'Stateless means both ways',
  client: 'Juniper Home, a furniture store',
  users: 'Shoppers on HTTPS; a compliance team that wants subnet-level firewalls',
  brief:
    "Compliance asked for network ACLs on the public subnets, so we added one: allow 443 in from anywhere, allow 443 out to the app tier. Since then customers' browsers just spin. The flow logs show our responses being REJECTED on the way out. Keep the NACL; make it right.",
  requirements: [
    { id: 'r1', text: 'Customers load the store over HTTPS' },
    { id: 'r2', text: 'The public subnets keep a custom NACL' },
  ],
  budget: 0,
  usage: usage0,
  layout: naclLayout,
  palette: ['alb', 'asg', 'nat'],
  start: { board: hardenedSubnets([toApp]).done(), fails: ['shop'] },
  events: [
    { id: 'shop', name: 'A shopper opens the store', desc: 'HTTPS from the internet to the load balancer, and the response back to the browser\'s ephemeral port.', domain: 'secure', concepts: ['nacls', 'sg-vs-nacl'], kind: 'reachability', params: { from: 'internet', to: 'alb', port: 443, expect: 'allow', label: { to: 'the store' } }, requirementIds: ['r1', 'r2'] },
  ],
  concepts: ['nacls', 'sg-vs-nacl', 'vpc-flow-logs'],
  reference: hardenedSubnets([toApp, ephemeral]).done(),
  mistakes: [
    { name: 'Ephemeral ports allowed only to the VPC', board: hardenedSubnets([toApp, rule(110, [1024, 65535], '10.110.0.0/16')]).done(), expectFail: ['shop'] },
    { name: 'Outbound 443 to the world instead', board: hardenedSubnets([toApp, rule(110, [443, 443], '0.0.0.0/0')]).done(), expectFail: ['shop'] },
  ],
  keywords: ['security groups are stateful; NACLs are stateless', 'NACL must allow return traffic on ephemeral ports 1024-65535', 'NACL rules evaluated in number order, first match wins', 'NACLs can DENY; security groups can only allow'],
  hints: ['Which port does the response go back to?', 'NACLs don\'t remember the request', 'Open the outbound rules of public-nacl'],
  distractors: ['vpce', 'rds', 'waf'],
  whyNot: { nat: 'A NAT gateway is for private instances starting connections out. The problem is responses leaving the public subnet.' },
  decisions: [
    {
      title: 'Allow responses out on ephemeral ports',
      choice: 'public-nacl allows outbound TCP 1024-65535 to 0.0.0.0/0, plus 443 to the app tier.',
      why: 'A browser connects from a random high port (1024-65535). NACLs are stateless, so the response from the load balancer back to that port is a separate packet that the outbound rules must allow. Security groups track connections and need no such rule.',
      events: ['shop'],
      components: ['public-nacl'],
      manual: ['nacls', 'sg-vs-nacl'],
    },
    {
      title: 'Security groups were never the problem',
      choice: 'store-alb and store-asg keep their security groups unchanged.',
      why: 'Flow logs showing REJECT on the way out, after an accepted request on the way in, point at a stateless NACL: a security group would have allowed the response automatically.',
      events: ['shop'],
      components: ['store-alb'],
      manual: ['vpc-flow-logs'],
    },
  ],
});

// =====================================================================================
// 27c. Peered, but silent (fix): peering needs routes on both sides, and doesn't route transitively.
// =====================================================================================

const pvpc = (key: string, octet: number): VpcSpec => ({
  id: `vpc-${key}`,
  name: key,
  cidr: `10.${octet}.0.0/16`,
  azs: [{ id: 'us-east-1a', name: 'us-east-1a' }],
  routeTables: [{ id: `rtb-${key}`, name: `rtb-${key}`, routes: [] }],
  subnets: [{ id: `${key}-a`, name: `${key}-a`, cidr: `10.${octet}.10.0/24`, az: 'us-east-1a', tier: 'app', routeTableId: `rtb-${key}` }],
});

const peerLayout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  vpc: pvpc('billing', 20),
  extraVpcs: [
    { regionId: 'us-east-1', regionName: 'US East (N. Virginia)', vpc: pvpc('analytics', 21) },
    { regionId: 'us-east-1', regionName: 'US East (N. Virginia)', vpc: pvpc('sandbox', 22) },
  ],
};

function peered(): BoardBuilder {
  return new BoardBuilder(peerLayout, 'bare')
    .place('ec2', 'billing-a', { name: 'billing-db' })
    .sgRule('billing-db', 'inbound', { protocol: 'tcp', fromPort: 5432, toPort: 5432, source: { cidr: '10.0.0.0/8' } })
    .place('ec2', 'analytics-a', { name: 'reporting' })
    .sgRule('reporting', 'outbound', { protocol: 'tcp', fromPort: 5432, toPort: 5432, source: { cidr: '10.0.0.0/8' } })
    .place('ec2', 'sandbox-a', { name: 'sandbox-box' })
    .sgRule('sandbox-box', 'outbound', { protocol: 'tcp', fromPort: 5432, toPort: 5432, source: { cidr: '10.0.0.0/8' } })
    .place('pcx', 'vpc-billing', { name: 'billing-analytics' })
    .config('billing-analytics', { peerVpcId: 'vpc-analytics' })
    .place('pcx', 'vpc-analytics', { name: 'analytics-sandbox' })
    .config('analytics-sandbox', { peerVpcId: 'vpc-sandbox' })
    .route('rtb-analytics', '10.22.0.0/16', { pcxName: 'analytics-sandbox' })
    .route('rtb-sandbox', '10.21.0.0/16', { pcxName: 'analytics-sandbox' });
}
const fwd = (b: BoardBuilder) => b.route('rtb-analytics', '10.20.0.0/16', { pcxName: 'billing-analytics' });
const back = (b: BoardBuilder) => b.route('rtb-billing', '10.21.0.0/16', { pcxName: 'billing-analytics' });

export const peeringLab = lab({
  id: 'c-vpc-peering',
  course: { section: 27, kind: 'fix', lectures: ['VPC Peering', 'VPC Peering Hands On', 'Transit Gateway', 'VPC Endpoints'] },
  title: 'Peered, but silent',
  client: 'Orchard Payroll',
  users: 'A billing database, a reporting server in an analytics VPC, and a sandbox VPC',
  brief:
    "We peered the billing VPC with analytics so the reporting server can query the billing database on 5432. The peering connection says Active, but every connection times out. Also, the sandbox VPC is peered with analytics, and the security team wants to be sure the sandbox can never reach billing, even after this fix.",
  requirements: [
    { id: 'r1', text: 'The reporting server reaches the billing database on 5432' },
    { id: 'r2', text: 'The sandbox can never reach billing' },
  ],
  budget: 0,
  usage: usage0,
  defaults: 'bare',
  layout: peerLayout,
  palette: ['ec2', 'pcx', 'tgw'],
  start: { board: fwd(peered()).done(), fails: ['report'] },
  events: [
    { id: 'report', name: 'Nightly report', desc: 'The reporting server opens 5432 to the billing database, and the reply comes back.', domain: 'secure', concepts: ['vpc-peering'], kind: 'reachability', params: { from: '"reporting"', to: '"billing-db"', port: 5432, expect: 'allow', label: { from: 'the reporting server', to: 'the billing database' } }, requirementIds: ['r1'] },
    { id: 'sandbox', name: 'A sandbox script wanders', desc: 'A test script in the sandbox tries 5432 on the billing database. Its security group allows 10.0.0.0/8, so only routing can stop it.', domain: 'secure', concepts: ['vpc-peering'], kind: 'reachability', params: { from: '"sandbox-box"', to: '"billing-db"', port: 5432, expect: 'deny', label: { from: 'the sandbox', to: 'the billing database' } }, requirementIds: ['r2'] },
  ],
  concepts: ['vpc-peering', 'transit-gateway', 'route-blackholes'],
  reference: back(fwd(peered())).done(),
  mistakes: [
    { name: 'Return route on billing, forward route removed', board: back(peered()).done(), expectFail: ['report'] },
    { name: 'Return route points at the sandbox CIDR', board: fwd(peered()).route('rtb-billing', '10.22.0.0/16', { pcxName: 'billing-analytics' }).done(), expectFail: ['report'] },
  ],
  keywords: ['VPC peering: routes needed in both VPCs\' route tables', 'peering is not transitive', 'CIDRs must not overlap', 'many VPCs → Transit Gateway'],
  hints: ['Packets need a route there and a route back', 'Look at rtb-billing', 'Would a route in sandbox to billing help? Peering is not transitive'],
  distractors: ['vgw', 's3', 'lambda'],
  whyNot: { tgw: 'A transit gateway would route between all three VPCs, and then route tables must stop the sandbox. For one pair, peering with the right routes is simpler and cheaper.' },
  decisions: [
    {
      title: 'Routes on both sides of the peering',
      choice: 'rtb-analytics sends 10.20.0.0/16 to billing-analytics, and rtb-billing sends 10.21.0.0/16 back.',
      why: 'An active peering connection only makes routing possible; each VPC still needs a route to the other\'s CIDR. Without the return route, the billing database\'s replies have nowhere to go and the client times out.',
      events: ['report'],
      components: ['rtb-billing', 'rtb-analytics'],
      manual: ['vpc-peering'],
    },
    {
      title: 'No path from the sandbox',
      choice: 'Billing has no peering with the sandbox, and analytics does not forward between them.',
      why: 'Peering is not transitive: traffic from the sandbox cannot hop through analytics into billing, whatever routes the sandbox adds. That is why it is safe to peer analytics with both.',
      events: ['sandbox'],
      components: ['rtb-sandbox', 'analytics-sandbox'],
      manual: ['vpc-peering', 'transit-gateway'],
    },
  ],
});
