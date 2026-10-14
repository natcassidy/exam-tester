// Section 8 (high availability and scalability: ELB and ASG).

import { BoardBuilder } from '../../engine/builder';
import { inRegion, lab, threeTierVpc, usage0 } from './helpers';

const layout = inRegion(threeTierVpc('vpc-ha', 60, ['app']));

/** ALB in front of an Auto Scaling group in both app subnets. */
function albAsg(): BoardBuilder {
  return new BoardBuilder(layout, 'helpful')
    .place('alb', 'public-a', { name: 'web-alb' })
    .place('asg', 'app-a', { name: 'web-asg' })
    .config('web-asg', { min: 2, desired: 2, max: 6, healthCheckType: 'ELB', healthCheckGraceSec: 300, policy: { kind: 'targetTracking', targetCpu: 50 } });
}

const reach = { id: 'reach', name: 'Customers reach the site', desc: 'HTTPS from the internet to the load balancer and on to a healthy target.', domain: 'resilient' as const, concepts: ['alb', 'alb-health-checks'], kind: 'reachability' as const, params: { from: 'internet', to: 'alb', port: 443, expect: 'allow', label: { to: 'a load balancer' } } };

const boxOffice = () => albAsg().config('web-asg', { min: 4, desired: 4, max: 8 });

// =====================================================================================
// 8a. Zero healthy targets (fix): a health check path the app doesn't serve, and EC2 health checks.
// =====================================================================================

export const healthChecksLab = lab({
  id: 'c-ha-health',
  course: { section: 8, kind: 'fix', lectures: ['Application Load Balancer (ALB)', 'Application Load Balancer (ALB) - Hands On - Part 1', 'Auto Scaling Groups (ASG) Overview', 'Auto Scaling Groups Hands On'] },
  title: 'Zero healthy targets',
  client: 'Pinecrest Tickets, an events box office',
  users: 'Steady ticket sales, about 200 requests a second',
  brief:
    "The target group shows every instance as unhealthy, yet the app works when we curl it on the box at /health. Last night the app process crashed on two instances and they sat there for hours serving errors, while Auto Scaling said everything was fine. We want dead instances replaced on their own.",
  requirements: [
    { id: 'r1', text: 'Customers reach the site through the load balancer' },
    { id: 'r2', text: 'An instance whose app has crashed is replaced automatically (≤ 1% errors)' },
  ],
  budget: 0,
  usage: usage0,
  layout,
  palette: ['alb', 'asg', 'ec2'],
  start: { board: boxOffice().config('web-alb', { healthCheck: { path: '/healthz', intervalSec: 30, timeoutSec: 5, healthyThreshold: 5, unhealthyThreshold: 2 } }).config('web-asg', { healthCheckType: 'EC2' }).done(), fails: ['crash'] },
  events: [
    { ...reach, requirementIds: ['r1'] },
    { id: 'crash', name: 'Two app processes crash', desc: 'The app dies on two instances at minute 0; the OS keeps running. 200 rps for an hour.', domain: 'resilient', concepts: ['asg-health-checks', 'alb-health-checks'], kind: 'fleetHealth', params: { entry: 'alb', loadRps: 200, durationMin: 60, crashed: 2, appBootSec: 120, slo: { errorRate: 0.01 } }, requirementIds: ['r2'] },
  ],
  concepts: ['alb-health-checks', 'asg-health-checks', 'alb', 'alb-error-codes'],
  reference: boxOffice().done(),
  mistakes: [
    { name: 'Path fixed, Auto Scaling still uses EC2 checks', board: boxOffice().config('web-asg', { healthCheckType: 'EC2' }).done(), expectFail: ['crash'] },
    { name: 'ELB checks on, path still wrong', board: boxOffice().config('web-alb', { healthCheck: { path: '/healthz', intervalSec: 30, timeoutSec: 5, healthyThreshold: 5, unhealthyThreshold: 2 } }).done(), expectFail: ['crash'] },
    { name: 'Grace period shorter than the app takes to boot', board: boxOffice().config('web-asg', { healthCheckGraceSec: 30 }).done(), expectFail: ['crash'] },
  ],
  keywords: ['all targets unhealthy → health check path/port vs what the app serves', 'ASG health check type ELB replaces instances the load balancer marks unhealthy', 'EC2 status checks only see the instance, not the app', 'grace period ≥ boot time'],
  hints: ['Compare the target group\'s health check path with what the app serves', 'Which health checks does the Auto Scaling group act on?', 'The 300 s grace period already gives new instances time to boot: keep it when the group starts acting on the load balancer'],
  distractors: ['route53', 'nat', 'rds'],
  whyNot: { ec2: 'A lone instance has nobody to replace it. The Auto Scaling group is what turns a failed health check into a new instance.' },
  decisions: [
    {
      title: 'Health check the path the app serves',
      choice: 'The target group checks /health, the path the app answers.',
      why: 'If every target is unhealthy, the ALB fails open and sends traffic to all of them, so the site seems to work while health checks protect nothing. A 503 means no target is registered or healthy; check the path and port first.',
      events: ['reach', 'crash'],
      components: ['web-alb'],
      manual: ['alb-health-checks', 'alb-error-codes'],
    },
    {
      title: 'Auto Scaling acts on the load balancer\'s health checks',
      choice: 'Health check type ELB with a 300 s grace period.',
      why: 'EC2 status checks only see the hardware and OS. With type ELB, an instance the load balancer marks unhealthy is terminated and replaced. The grace period stops the group from killing instances that are still booting.',
      events: ['crash'],
      components: ['web-asg'],
      manual: ['asg-health-checks'],
    },
  ],
});

// =====================================================================================
// 8b. One AZ, no scaling (finish): spread the group and let it grow.
// =====================================================================================

const surge = [
  { min: 0, rps: 200 },
  { min: 10, rps: 200 },
  { min: 30, rps: 1000 },
  { min: 60, rps: 1000 },
  { min: 70, rps: 300 },
];

export const scaleOutLab = lab({
  id: 'c-ha-scale',
  course: { section: 8, kind: 'finish', lectures: ['High Availability and Scalability', 'Elastic Load Balancer - Cross Zone Load Balancing', 'Auto Scaling Groups - Scaling Policies', 'Auto Scaling Groups - Scaling Policies Hands On'] },
  title: 'One AZ, no scaling',
  client: 'Larkspur News, a local news site',
  users: '200 requests a second normally, 1,000 when a story breaks',
  brief:
    "Our load balancer and Auto Scaling group are set up, but the group only launches into one subnet, never grows past two instances, and has no scaling policy. When a big story breaks traffic goes up fivefold within twenty minutes, and if that one data centre has a bad day we are off the air.",
  requirements: [
    { id: 'r1', text: 'Customers reach the site through the load balancer' },
    { id: 'r2', text: 'Breaking news (5× traffic): ≤ 1% errors, p95 ≤ 800 ms', target: { p95Ms: 800 } },
    { id: 'r3', text: 'Lose an AZ: back within 5 minutes', target: { rtoSec: 300 } },
    { id: 'r4', text: 'Under $400/month at normal load', target: { budget: 400 } },
  ],
  budget: 400,
  usage: { ...usage0, requestsPerMonth: 600_000_000, dataOutGb: 300 },
  layout,
  palette: ['alb', 'asg', 'ec2', 'route53'],
  start: { board: albAsg().subnets('web-asg', ['app-a']).config('web-asg', { max: 2, policy: { kind: 'none' } }).done(), fails: ['surge', 'az-outage'] },
  events: [
    { ...reach, requirementIds: ['r1'] },
    { id: 'surge', name: 'Breaking news', desc: 'Traffic climbs from 200 to 1,000 rps over 20 minutes and holds for half an hour.', domain: 'performant', concepts: ['asg-scaling', 'static-stability'], kind: 'traffic', params: { entry: 'alb', profile: surge, durationMin: 80, slo: { errorRate: 0.01, p95Ms: 800 }, baseLatencyMs: 60 }, requirementIds: ['r2'] },
    { id: 'az-outage', name: 'us-east-1a goes dark', desc: 'A power event takes out us-east-1a at 200 rps.', domain: 'resilient', concepts: ['static-stability', 'alb'], kind: 'azOutage', params: { az: 'us-east-1a', loadRps: 200, rtoSec: 300, rpoSec: 60 }, requirementIds: ['r3'] },
    { id: 'bill', name: 'Monthly bill', desc: 'Normal load all month plus a few surges.', domain: 'cost', concepts: ['asg-scaling'], kind: 'bill', params: {}, requirementIds: ['r4'], passesOnEmptyBoard: true },
  ],
  concepts: ['asg-scaling', 'static-stability', 'alb', 'alb-health-checks'],
  reference: albAsg().config('web-asg', { max: 12 }).done(),
  mistakes: [
    { name: 'Two AZs, still capped at two instances', board: albAsg().config('web-asg', { max: 2 }).done(), expectFail: ['surge'] },
    { name: 'Scales, but only in us-east-1a', board: albAsg().subnets('web-asg', ['app-a']).config('web-asg', { max: 12 }).done(), expectFail: ['az-outage'] },
    { name: 'No scaling policy, max 12', board: albAsg().config('web-asg', { max: 12, policy: { kind: 'none' } }).done(), expectFail: ['surge'] },
    { name: 'Twelve instances running all the time', board: albAsg().config('web-asg', { min: 12, desired: 12, max: 12 }).done(), expectFail: ['bill'] },
  ],
  keywords: ['high availability = multi-AZ', 'scalability = Auto Scaling with a scaling policy', 'target tracking on CPU', 'max capacity sized for the peak, min for the baseline'],
  hints: ['Tick the app subnet in the second AZ', 'Raise the group\'s maximum', 'Add a target tracking policy'],
  distractors: ['cloudfront', 'nat', 'sqs'],
  whyNot: {
    ec2: 'A standalone instance can\'t scale out or be replaced automatically. Keep the fleet in the Auto Scaling group.',
    route53: 'DNS points at the load balancer, but it adds no capacity and no AZ resilience on its own.',
    cloudfront: 'Caching would help static pages, but the articles are dynamic here; the fix is capacity and AZs.',
  },
  decisions: [
    {
      title: 'Spread the group over two AZs',
      choice: 'web-asg launches into app-a and app-b.',
      why: 'High availability means surviving a data centre: with instances in two AZs, the load balancer stops sending to the dead one and the group replaces lost capacity in the other.',
      events: ['reach', 'az-outage'],
      components: ['web-asg'],
      fields: ['placement'],
      manual: ['static-stability'],
    },
    {
      title: 'Let it grow: target tracking and a real maximum',
      choice: 'Target tracking at 50% CPU, min 2, max 12.',
      why: 'Scalability is the policy plus the headroom to use it. Target tracking adds instances as CPU climbs; the maximum must cover the peak (1,000 rps needs about ten instances here), while min and desired stay at the cheap baseline.',
      events: ['surge', 'bill'],
      components: ['web-asg'],
      fields: ['max', 'min', 'desired', 'policy'],
      manual: ['asg-scaling'],
    },
  ],
});

// =====================================================================================
// 8c. HTTP on the front door (fix): HTTPS listener, and an app tier only the ALB can reach.
// =====================================================================================

function httpsBoard(): BoardBuilder {
  return albAsg();
}

const insecureStart = () =>
  httpsBoard()
    .config('web-alb', { listener: { port: 80, protocol: 'HTTP' } })
    .dropSgRules('web-alb', 'inbound', () => true)
    .sgRule('web-alb', 'inbound', { protocol: 'tcp', fromPort: 80, toPort: 80, source: { cidr: '0.0.0.0/0' } })
    .dropSgRules('web-asg', 'inbound', () => true)
    .sgRule('web-asg', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } });

export const httpsLab = lab({
  id: 'c-ha-https',
  course: { section: 8, kind: 'fix', lectures: ['Elastic Load Balancer - SSL Certificates', 'Elastic Load Balancer - SSL Certificates - Hands On', 'Application Load Balancer (ALB) - Hands On - Part 2', 'Security Groups & Classic Ports Overview'] },
  title: 'HTTP on the front door',
  client: 'Orchard Health, a clinic booking app',
  users: 'Patients booking appointments, with names and dates of birth in every form',
  brief:
    "A penetration test flagged two things: our load balancer only listens on plain HTTP, and our app servers accept HTTPS from the whole internet, not just from the load balancer. Patients must connect over HTTPS, and nothing but the load balancer should ever talk to the app tier.",
  requirements: [
    { id: 'r1', text: 'Patients connect to the load balancer over HTTPS (443)' },
    { id: 'r2', text: 'Only the load balancer can reach the app servers' },
  ],
  budget: 0,
  usage: usage0,
  layout,
  palette: ['alb', 'asg', 'waf'],
  start: { board: insecureStart().done(), fails: ['reach', 'audit'] },
  events: [
    { ...reach, desc: 'A patient opens https://book.orchard.health: TLS on 443 to the load balancer, then on to the app tier.', requirementIds: ['r1'] },
    { id: 'audit', name: 'Penetration test retest', desc: 'HTTPS on the listener, private app tier, security groups chained.', domain: 'secure', concepts: ['sg-chaining', 'security-groups'], kind: 'audit', params: { rules: ['httpsOnly', 'appTierPrivate', 'privateTierSgsChained'] }, requirementIds: ['r1', 'r2'] },
  ],
  concepts: ['alb', 'sg-chaining', 'security-groups', 'vpc-public-private'],
  reference: httpsBoard().done(),
  mistakes: [
    { name: 'HTTPS listener, but the ALB group still only allows port 80', board: insecureStart().config('web-alb', { listener: { port: 443, protocol: 'HTTPS' } }).done(), expectFail: ['reach', 'audit'] },
    { name: 'Front door fixed, app tier still open to the world', board: httpsBoard().dropSgRules('web-asg', 'inbound', () => true).sgRule('web-asg', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' } }).done(), expectFail: ['audit'] },
    { name: 'App servers given public IPs', board: httpsBoard().config('web-asg', { publicIp: true }).done(), expectFail: ['audit'] },
  ],
  keywords: ['TLS terminates at the load balancer with an ACM certificate', 'redirect HTTP to HTTPS', 'app tier security group source = the ALB security group', 'SNI lets one ALB serve many certificates'],
  hints: ['Open the load balancer: which protocol and port does the listener use?', 'Its security group must allow that port', 'The app tier\'s inbound rule should name the load balancer\'s group, not 0.0.0.0/0'],
  distractors: ['cloudfront', 'route53', 'nat'],
  whyNot: { waf: 'WAF filters malicious requests, but neither finding is about request content: one is the listener protocol, the other the app tier\'s security group.' },
  decisions: [
    {
      title: 'An HTTPS listener on 443',
      choice: 'web-alb listens on HTTPS 443 with an ACM certificate, and its security group allows 443 from anywhere.',
      why: 'TLS terminates at the load balancer, which holds the certificate (ACM issues and renews it for free). Plain HTTP sends patient data in the clear. Listener and security group must agree on the port.',
      events: ['reach', 'audit'],
      components: ['web-alb'],
      manual: ['alb'],
    },
    {
      title: 'Chain the app tier to the load balancer',
      choice: "web-asg's group allows 443 only from web-alb's security group.",
      why: 'A security group as the source means "anything carrying that group", so the rule keeps working as instances come and go. 0.0.0.0/0 lets anyone who finds an instance address skip the load balancer.',
      events: ['audit'],
      components: ['web-asg'],
      manual: ['sg-chaining'],
    },
  ],
});
