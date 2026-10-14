// Section 5 (EC2 fundamentals) and section 6 (EC2 at Solutions Architect level).

import { BoardBuilder } from '../../engine/builder';
import { inRegion, lab, publicVpc, threeTierVpc, usage0 } from './helpers';

const OFFICE = '203.0.113.0/24';

// =====================================================================================
// 5a. Your first web server (build).
// =====================================================================================

const webLayout = inRegion(publicVpc('vpc-web', 50));

function webServer(): BoardBuilder {
  return new BoardBuilder(webLayout, 'bare')
    .place('ec2', 'public-a', { name: 'web-server' })
    .config('web-server', { publicIp: true, instanceType: 't3.micro' })
    .sgRule('web-server', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' }, description: 'HTTPS from anywhere' });
}

const visitWeb = { id: 'visit', name: 'A visitor opens the site', desc: 'Someone on the internet opens https:// on the server.', domain: 'performant' as const, concepts: ['security-groups', 'internet-gateway'], kind: 'reachability' as const, params: { from: 'internet', to: 'ec2', port: 443, expect: 'allow', label: { to: 'a web server' } } };
const sshAudit = { id: 'audit', name: 'Security scan', desc: 'A scanner looks for admin ports open to the whole internet.', domain: 'secure' as const, concepts: ['security-groups'], kind: 'audit' as const, params: { rules: ['noSshFromWorld'] } };

export const firstServerLab = lab({
  id: 'c-ec2-first',
  course: { section: 5, kind: 'build', lectures: ['EC2 Basics', 'Create an EC2 Instance with EC2 User Data to have a Website Hands On', 'EC2 Instance Types Basics', 'Security Groups & Classic Ports Overview'] },
  title: 'Your first web server',
  client: 'Juniper Bakes, a neighbourhood bakery',
  users: 'A few hundred visitors a day looking at the menu',
  brief:
    "We want our menu site on one small server: a single instance in a public subnet, serving HTTPS to anyone. Keep it cheap, it's a bakery. Our nephew says to open SSH to everyone 'so he can log in from anywhere'. We'd rather not end up on the news.",
  requirements: [
    { id: 'r1', text: 'Anyone on the internet can load the site over HTTPS (443)' },
    { id: 'r2', text: 'No SSH or RDP open to the internet' },
    { id: 'r3', text: 'Under $15/month', target: { budget: 15 } },
  ],
  budget: 15,
  usage: { ...usage0, dataOutGb: 5 },
  defaults: 'bare',
  layout: webLayout,
  palette: ['ec2', 'alb', 'asg'],
  events: [
    { ...visitWeb, requirementIds: ['r1'] },
    { ...sshAudit, requirementIds: ['r2'] },
    { id: 'bill', name: 'Monthly bill', desc: 'One instance running all month, plus a public IPv4 address.', domain: 'cost', concepts: ['ec2-purchase-options'], kind: 'bill', params: {}, requirementIds: ['r3'], passesOnEmptyBoard: true },
  ],
  concepts: ['security-groups', 'internet-gateway', 'vpc-public-private', 'ec2-purchase-options'],
  reference: webServer().done(),
  mistakes: [
    { name: 'No public IP', board: webServer().config('web-server', { publicIp: false }).done(), expectFail: ['visit'] },
    { name: 'SSH open to 0.0.0.0/0', board: webServer().sgRule('web-server', 'inbound', { protocol: 'tcp', fromPort: 22, toPort: 22, source: { cidr: '0.0.0.0/0' } }).done(), expectFail: ['audit'] },
    { name: 'An m5.xlarge for a menu', board: webServer().config('web-server', { instanceType: 'm5.xlarge' }).done(), expectFail: ['bill'] },
    { name: 'Only port 80 open', board: webServer().dropSgRules('web-server', 'inbound', () => true).sgRule('web-server', 'inbound', { protocol: 'tcp', fromPort: 80, toPort: 80, source: { cidr: '0.0.0.0/0' } }).done(), expectFail: ['visit'] },
  ],
  keywords: ['security groups are allow-only and stateful', 'a public subnet routes 0.0.0.0/0 to an internet gateway', 'needs a public IP to be reached from the internet', 'admin access without open ports → EC2 Instance Connect / Session Manager'],
  hints: ['One EC2 instance in a public subnet', 'Give it a public IP', 'Its security group needs one inbound rule: 443 from anywhere', 'The smallest instance type does the job'],
  distractors: ['rds', 'nat', 'cloudfront'],
  whyNot: {
    alb: 'A load balancer earns its keep with two or more servers. For one small server it costs more than the server.',
    asg: 'An Auto Scaling group would replace a failed server, but the brief asks for one cheap instance and accepts the risk.',
    nat: 'A NAT gateway gives private subnets outbound access. The web server sits in a public subnet with its own public IP.',
  },
  decisions: [
    {
      title: 'A public subnet and a public IP',
      choice: 'web-server runs in public-a, whose route table sends 0.0.0.0/0 to the internet gateway, with a public IPv4 address.',
      why: 'Both are needed: the route makes the subnet public, and the address is what the internet connects to. Without a public IP an instance in a public subnet is still unreachable.',
      events: ['visit'],
      components: ['web-server'],
      fields: ['publicIp', 'placement'],
      manual: ['vpc-public-private', 'internet-gateway'],
    },
    {
      title: 'Open 443 to the world, and nothing else',
      choice: 'The security group allows TCP 443 from 0.0.0.0/0 and has no SSH rule.',
      why: 'Security groups deny everything not allowed, so you add only what visitors need. Admin access goes through EC2 Instance Connect or Session Manager, not port 22 open to everyone.',
      events: ['visit', 'audit'],
      components: ['web-server'],
      fields: ['securityGroups'],
      manual: ['security-groups'],
    },
    {
      title: 'Right-size the instance',
      choice: 't3.micro: a burstable instance for a site with a few hundred visitors a day.',
      why: 'T-family instances bank CPU credits while idle and burst when busy, which fits light, spiky traffic at the lowest price.',
      events: ['bill'],
      components: ['web-server'],
      fields: ['instanceType'],
      manual: ['ec2-purchase-options'],
    },
  ],
});

// =====================================================================================
// 5b. Timeouts (fix): wrong port open, SSH to the world, no outbound rule.
// =====================================================================================

function timeouts(): BoardBuilder {
  return new BoardBuilder(webLayout, 'bare')
    .place('ec2', 'public-a', { name: 'shop-server' })
    .config('shop-server', { publicIp: true, instanceType: 't3.small' })
    .clearSg('shop-server', 'outbound');
}

const timeoutsRef = () =>
  timeouts()
    .sgRule('shop-server', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' }, description: 'HTTPS from anywhere' })
    .sgRule('shop-server', 'inbound', { protocol: 'tcp', fromPort: 22, toPort: 22, source: { cidr: OFFICE }, description: 'SSH from the office' })
    .sgRule('shop-server', 'outbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' }, description: 'HTTPS out for updates' });

export const timeoutsLab = lab({
  id: 'c-ec2-sg',
  course: { section: 5, kind: 'fix', lectures: ['Security Groups & Classic Ports Overview', 'Security Groups Hands On', 'SSH Overview', 'SSH Troubleshooting', 'EC2 Instance Connect'] },
  title: 'Connection timed out',
  client: 'Moss & Fern, a plant shop',
  users: 'An online shop on one EC2 instance',
  brief:
    "Our shop server times out for every customer, and it can't download its updates either. Someone 'fixed' it last week by opening SSH and HTTP to the world. The site is HTTPS only. Our admin connects over SSH from the office (203.0.113.0/24) and nowhere else.",
  requirements: [
    { id: 'r1', text: 'Customers load the shop over HTTPS' },
    { id: 'r2', text: 'The server can download updates over HTTPS' },
    { id: 'r3', text: 'SSH only from the office, never from the internet' },
  ],
  budget: 0,
  usage: usage0,
  defaults: 'bare',
  layout: webLayout,
  palette: ['ec2'],
  start: {
    board: timeouts()
      .sgRule('shop-server', 'inbound', { protocol: 'tcp', fromPort: 22, toPort: 22, source: { cidr: '0.0.0.0/0' } })
      .sgRule('shop-server', 'inbound', { protocol: 'tcp', fromPort: 80, toPort: 80, source: { cidr: '0.0.0.0/0' } })
      .done(),
    fails: ['visit', 'updates', 'audit'],
  },
  events: [
    { ...visitWeb, desc: 'A customer opens https:// on the shop.', requirementIds: ['r1'] },
    { id: 'updates', name: 'Nightly updates', desc: 'shop-server downloads packages over HTTPS from the internet.', domain: 'secure', concepts: ['security-groups', 'sg-vs-nacl'], kind: 'reachability', params: { from: 'ec2', to: 'internet', port: 443, expect: 'allow', label: { from: 'the shop server' } }, requirementIds: ['r2'] },
    { ...sshAudit, requirementIds: ['r3'] },
  ],
  concepts: ['security-groups', 'sg-vs-nacl', 'vpc-public-private'],
  reference: timeoutsRef().done(),
  mistakes: [
    { name: 'Inbound fixed, still no outbound rule', board: timeouts().sgRule('shop-server', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } }).done(), expectFail: ['updates'] },
    { name: 'Everything fixed but SSH still open to the world', board: timeoutsRef().sgRule('shop-server', 'inbound', { protocol: 'tcp', fromPort: 22, toPort: 22, source: { cidr: '0.0.0.0/0' } }).done(), expectFail: ['audit'] },
  ],
  keywords: ['timeout → security group; "connection refused" → the application', 'security groups are stateful: replies to allowed inbound traffic are always allowed out', 'outbound rules only matter for connections the instance starts', 'restrict SSH to a known CIDR, or use EC2 Instance Connect'],
  hints: ['A timeout almost always means a security group', 'Which port does HTTPS use?', 'The server starts its own connection to download updates: what lets it out?'],
  distractors: ['alb', 'nat', 'vpce'],
  whyNot: {
    nat: 'The server is in a public subnet with a public IP: it already has a path out. The problem is the security group, not the route.',
    vpce: 'A gateway endpoint reaches S3 and DynamoDB privately. The updates come from the internet, and the server already has a path there.',
    alb: 'A load balancer would not fix this: its own security group and the instance\'s would still need the right rules.',
  },
  decisions: [
    {
      title: 'Inbound: HTTPS from anywhere, SSH from the office only',
      choice: 'Inbound TCP 443 from 0.0.0.0/0 (the site is HTTPS, so port 80 does nothing for it) and TCP 22 from 203.0.113.0/24.',
      why: 'A connection that times out never reached anything that could answer: the classic sign of a missing security group rule ("connection refused" would mean nothing was listening). Port 22 open to the world is brute-forced within minutes; restrict it to a known range, or use EC2 Instance Connect or Session Manager.',
      events: ['visit', 'audit'],
      components: ['shop-server'],
      fields: ['securityGroups.inbound'],
      manual: ['security-groups'],
    },
    {
      title: 'Outbound only for what the server starts',
      choice: 'One outbound rule: TCP 443 to 0.0.0.0/0, for package downloads.',
      why: 'Security groups are stateful: replies to the customers\' connections leave without an outbound rule. But a connection the instance starts itself needs one. NACLs are the stateless ones.',
      events: ['updates'],
      components: ['shop-server'],
      fields: ['securityGroups.outbound'],
      manual: ['sg-vs-nacl'],
    },
  ],
});

// =====================================================================================
// 5c. Spot for the image batch (finish).
// =====================================================================================

const batchLayout = inRegion(threeTierVpc('vpc-batch', 51, ['work']));
const spot = (onDemandBase: number, allocation: 'lowest-price' | 'capacity-optimized' | 'price-capacity-optimized', extraTypes: string[] = []) => ({ purchase: { onDemandBase, spotPercent: 100, allocation, extraTypes } });

function imageFleet(): BoardBuilder {
  return new BoardBuilder(batchLayout, 'helpful')
    .place('asg', 'work-a', { name: 'thumbnailers' })
    .config('thumbnailers', { instanceType: 'c5.large', min: 10, desired: 10, max: 10, policy: { kind: 'none' } });
}

export const spotLab = lab({
  id: 'c-ec2-spot',
  course: { section: 5, kind: 'finish', lectures: ['EC2 Instance Purchasing Options', 'Spot Instances & Spot Fleet', 'EC2 Instances Launch Types Hands On'] },
  title: 'Spot for the thumbnail batch',
  client: 'Shutterloop, a photo-sharing app',
  users: 'Ten workers resizing photos around the clock; any job can be retried',
  brief:
    "Ten c5.large workers make thumbnails all day, all On-Demand. Every job is small and idempotent: if a worker vanishes, another picks the job up. We need at least eight workers running at any moment or the backlog grows. Finance wants the bill cut by more than half. Spot sounds right, but last time we tried it a capacity crunch took out every worker at once.",
  requirements: [
    { id: 'r1', text: 'At least 8 workers running, even during a Spot capacity crunch' },
    { id: 'r2', text: 'Compute under $350/month (about $620 today)', target: { budget: 350 } },
  ],
  budget: 350,
  usage: usage0,
  layout: batchLayout,
  palette: ['asg', 'ec2', 'savings'],
  start: { board: imageFleet().done(), fails: ['bill'] },
  events: [
    { id: 'crunch', name: 'Spot capacity crunch', desc: 'A big event elsewhere in the Region drains the cheapest c5 pools for an hour. EC2 reclaims Spot instances there with a two-minute warning.', domain: 'resilient', concepts: ['ec2-spot'], kind: 'spotReclaim', params: { target: 'asg', requiredInstances: 8, crunchMin: 60 }, requirementIds: ['r1'] },
    { id: 'bill', name: 'Monthly bill', desc: 'Ten workers, 730 hours a month.', domain: 'cost', concepts: ['ec2-spot', 'ec2-purchase-options'], kind: 'bill', params: {}, requirementIds: ['r2'], passesOnEmptyBoard: true },
  ],
  concepts: ['ec2-spot', 'ec2-purchase-options', 'asg-scaling'],
  reference: imageFleet().config('thumbnailers', spot(2, 'price-capacity-optimized', ['m5.large', 'm6i.large'])).done(),
  mistakes: [
    { name: 'All Spot, lowest price, one type', board: imageFleet().config('thumbnailers', spot(0, 'lowest-price')).done(), expectFail: ['crunch'] },
    { name: 'Capacity-optimized but only c5.large', board: imageFleet().config('thumbnailers', spot(2, 'capacity-optimized')).done(), expectFail: ['crunch'] },
    { name: 'Eight On-Demand, two Spot', board: imageFleet().config('thumbnailers', spot(8, 'price-capacity-optimized', ['m5.large', 'm6i.large'])).done(), expectFail: ['bill'] },
  ],
  keywords: ['fault-tolerant, interruptible, retryable → Spot', 'diversify instance types and AZs', 'price-capacity-optimized allocation', 'On-Demand base for capacity you can never lose'],
  hints: ['Mix Spot and On-Demand on the Auto Scaling group', 'Allow more instance types: each type in each AZ is its own Spot pool', 'An allocation strategy that avoids the contested pools'],
  distractors: ['lambda', 'sqs', 'nat'],
  whyNot: {
    savings: 'A Savings Plan cuts about 30-40% for steady On-Demand use. Spot cuts up to 90% for interruptible work, and this work is interruptible.',
    ec2: 'Single instances would not replace themselves when Spot reclaims them. The Auto Scaling group does that.',
  },
  decisions: [
    {
      title: 'Spot above a small On-Demand base',
      choice: 'Two On-Demand instances always run; everything above them is Spot.',
      why: 'Retryable, idempotent jobs are the textbook Spot workload, at up to 90% off. The On-Demand base keeps a floor no Spot event can take away.',
      events: ['bill', 'crunch'],
      components: ['thumbnailers'],
      fields: ['purchase.onDemandBase', 'purchase.spotPercent'],
      manual: ['ec2-spot', 'ec2-purchase-options'],
    },
    {
      title: 'Many pools, capacity-aware allocation',
      choice: 'c5.large, m5.large and m6i.large across two AZs, with price-capacity-optimized allocation.',
      why: 'Each instance type in each AZ is a separate Spot pool. More pools and an allocation strategy that picks the deepest ones means a crunch in one pool takes out few or none of your workers.',
      events: ['crunch'],
      components: ['thumbnailers'],
      fields: ['purchase.allocation', 'purchase.extraTypes'],
      manual: ['ec2-spot'],
    },
  ],
});

// =====================================================================================
// 6a. The public IP that goes nowhere (fix): a public subnet without its route, an instance without an address.
// =====================================================================================

const ipLayout = inRegion(threeTierVpc('vpc-ip', 52, ['data']));

function ipBoard(): BoardBuilder {
  return new BoardBuilder(ipLayout, 'bare')
    .place('ec2', 'public-a', { name: 'api-server' })
    .sgRule('api-server', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } })
    .place('ec2', 'data-a', { name: 'cache-box' })
    .config('cache-box', { instanceType: 't3.small' })
    .sgRule('cache-box', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { sgOf: 'api-server' } });
}

export const publicIpLab = lab({
  id: 'c-ec2-ip',
  course: { section: 6, kind: 'fix', lectures: ['Private vs Public vs Elastic IP', 'Private vs Public vs Elastic IP Hands On', 'Elastic Network Interfaces (ENI) - Overview'] },
  title: 'The public IP that goes nowhere',
  client: 'Tidewater Charts, a sailing weather API',
  users: 'Sailors\' apps calling an API server; a cache box behind it',
  brief:
    "After a 'network cleanup' our API server stopped answering. The cleanup removed a route that 'looked unused', and the server was relaunched without a public address. The cache box behind it must stay private: no public address, nothing on the internet able to reach it.",
  requirements: [
    { id: 'r1', text: 'Apps reach the API server over HTTPS from the internet' },
    { id: 'r2', text: 'The cache box is unreachable from the internet' },
    { id: 'r3', text: 'The API server can still reach the cache box' },
  ],
  budget: 0,
  usage: usage0,
  defaults: 'bare',
  layout: ipLayout,
  palette: ['ec2', 'igw', 'nat'],
  start: { board: ipBoard().removeRoute('rtb-public', '0.0.0.0/0').done(), fails: ['visit'] },
  events: [
    { ...visitWeb, desc: 'A sailor\'s app calls https:// on the API server.', params: { ...visitWeb.params, to: '"api-server"', label: { to: 'the API server' } }, requirementIds: ['r1'] },
    { id: 'cache-private', name: 'Scanner probes the cache box', desc: 'Someone on the internet tries port 443 on the cache box.', domain: 'secure', concepts: ['vpc-public-private'], kind: 'reachability', params: { from: 'internet', to: '"cache-box"', port: 443, expect: 'deny', label: { to: 'the cache box' } }, requirementIds: ['r2'] },
    { id: 'api-cache', name: 'API reads the cache', desc: 'api-server connects to cache-box on 443 inside the VPC.', domain: 'secure', concepts: ['sg-chaining'], kind: 'reachability', params: { from: '"api-server"', to: '"cache-box"', port: 443, expect: 'allow', label: { from: 'the API server', to: 'the cache box' } }, requirementIds: ['r3'] },
  ],
  concepts: ['vpc-public-private', 'internet-gateway', 'route-blackholes', 'sg-chaining'],
  reference: ipBoard().config('api-server', { publicIp: true }).done(),
  mistakes: [
    { name: 'Route restored, still no public IP', board: ipBoard().done(), expectFail: ['visit'] },
    { name: 'Public IP, but the route is still missing', board: ipBoard().removeRoute('rtb-public', '0.0.0.0/0').config('api-server', { publicIp: true }).done(), expectFail: ['visit'] },
    {
      name: 'Cache box on the public route table with a public IP',
      board: ipBoard().config('api-server', { publicIp: true }).config('cache-box', { publicIp: true }).associate('data-a', 'routeTableId', 'rtb-public').sgRule('cache-box', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } }).done(),
      expectFail: ['cache-private'],
    },
  ],
  keywords: ['public subnet = route to an internet gateway', 'public IPv4 changes on stop/start → Elastic IP for a fixed address', 'private IP stays for the life of the ENI', 'private instances: no public IP, no route to the IGW'],
  hints: ['Open rtb-public: where does 0.0.0.0/0 go?', 'Is the API server\'s public IPv4 turned on?', 'Leave the cache box alone'],
  distractors: ['alb', 'vpce', 'pcx'],
  whyNot: {
    igw: 'The VPC still has its internet gateway: only the route to it was deleted. A VPC can have just one.',
    nat: 'A NAT gateway lets private instances start connections out. It never lets the internet in, so it cannot make the API reachable.',
  },
  decisions: [
    {
      title: 'The public route table sends 0.0.0.0/0 to the internet gateway',
      choice: 'rtb-public: 0.0.0.0/0 → igw.',
      why: 'That one route is what makes a subnet public. Without it, packets from the internet reach the gateway but replies have no way out, so even an instance with a public IP is unreachable.',
      events: ['visit'],
      components: ['rtb-public'],
      manual: ['internet-gateway', 'route-blackholes'],
    },
    {
      title: 'A public address on the API server only',
      choice: 'api-server has a public IPv4; cache-box has none and stays on the private route table.',
      why: 'The internet gateway translates a public address to the instance\'s private one; no public address, nothing to translate. Public IPs change on stop/start, so a server that needs a fixed address gets an Elastic IP.',
      events: ['visit', 'cache-private', 'api-cache'],
      components: ['api-server', 'cache-box'],
      manual: ['vpc-public-private'],
    },
  ],
});
