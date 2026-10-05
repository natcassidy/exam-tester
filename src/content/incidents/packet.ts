import type { Mission, NaclRule } from '../../engine/model';
import type { BoardBuilder } from '../../engine/builder';
import { ev, incidentBase, prodLayout, threeTier } from './shared';

const rule = (ruleNumber: number, protocol: NaclRule['protocol'], portRange: [number, number], cidr: string, action: 'allow' | 'deny' = 'allow'): NaclRule => ({ ruleNumber, protocol, portRange, cidr, action });

/** Last night's "network hardening": a custom NACL on the app subnets with no outbound rule for responses. */
function start(): BoardBuilder {
  return threeTier()
    .nacl('acl-app', 'app-nacl', 'vpc-prod')
    .naclRule('acl-app', 'inbound', rule(100, 'tcp', [443, 443], '10.0.0.0/23'))
    .naclRule('acl-app', 'inbound', rule(110, 'tcp', [1024, 65535], '0.0.0.0/0'))
    .naclRule('acl-app', 'outbound', rule(100, 'tcp', [3306, 3306], '10.0.20.0/23'))
    .naclRule('acl-app', 'outbound', rule(110, 'tcp', [443, 443], '0.0.0.0/0'))
    .associate('app-a', 'naclId', 'acl-app')
    .associate('app-b', 'naclId', 'acl-app');
}

const startingBoard = start().done();

export const packetIncident: Mission = {
  ...incidentBase(),
  id: 'inc-packet',
  title: 'The packet that never came back',
  client: 'Ledgerly, the morning after',
  users: 'Every customer, since 02:10',
  brief:
    "Last night the network team 'hardened' the app subnets with a custom network ACL. Since 02:10 every page load hangs for a minute and then fails. Nobody touched the servers, and the servers say they're answering. Find out where the responses go.",
  requirements: [
    { id: 'r1', text: 'Customers reach the app over HTTPS again' },
    { id: 'r2', text: 'The app still reaches its database and patch servers' },
    { id: 'r3', text: 'No new exposure: the security audit still passes' },
  ],
  layout: prodLayout,
  startingBoard,
  events: [ev.reach(['r1']), ev.appDb(['r2']), ev.patch(['r2']), ev.audit(['dbNotPublic', 'noSshFromWorld', 'appTierPrivate', 'privateTierSgsChained'], ['r3'])],
  incident: {
    alert: { title: 'ALB returning 504 Gateway Timeout', detail: 'web-alb · target group 0/4 healthy · HTTPCode_ELB_5XX_Count 3,412 in 15 min' },
    budget: 8,
    par: 3,
    logs: [
      {
        id: 'alb',
        kind: 'alb',
        title: 'ALB access logs (web-alb)',
        note: 'type · time · client:port · target:port · request/target/response processing time · ELB status · target status · request',
        lines: [
          'https 2026-10-05T02:14:07.412Z app/web-alb 203.0.113.50:51234 10.0.10.21:443 0.000 -1 -1 504 - "GET https://app.ledgerly.example:443/invoices HTTP/1.1"',
          'https 2026-10-05T02:14:09.881Z app/web-alb 198.51.100.7:40411 10.0.11.35:443 0.001 -1 -1 504 - "GET https://app.ledgerly.example:443/ HTTP/1.1"',
          'https 2026-10-05T02:14:12.020Z app/web-alb 203.0.113.91:62001 10.0.10.28:443 0.000 -1 -1 504 - "POST https://app.ledgerly.example:443/api/close HTTP/1.1"',
          '# target_processing_time -1 and target status "-": the ALB never got a response from the target.',
        ],
      },
      {
        id: 'flow',
        kind: 'flow',
        title: 'VPC Flow Logs (app-a ENI eni-0app1a)',
        note: 'version · account · interface · srcaddr · dstaddr · srcport · dstport · protocol · packets · bytes · start · end · action · status',
        lines: [
          '2 111122223333 eni-0app1a 10.0.0.14 10.0.10.21 41822 443 6 5 420 1759630440 1759630500 ACCEPT OK',
          '2 111122223333 eni-0app1a 10.0.10.21 10.0.0.14 443 41822 6 5 2840 1759630440 1759630500 REJECT OK',
          '2 111122223333 eni-0app1a 10.0.1.9 10.0.10.21 50112 443 6 4 336 1759630440 1759630500 ACCEPT OK',
          '2 111122223333 eni-0app1a 10.0.10.21 10.0.1.9 443 50112 6 4 2210 1759630440 1759630500 REJECT OK',
          '2 111122223333 eni-0app1a 10.0.10.21 10.0.20.40 38110 3306 6 12 1460 1759630440 1759630500 ACCEPT OK',
        ],
      },
      {
        id: 'cloudwatch',
        kind: 'cloudwatch',
        title: 'CloudWatch metrics (web-alb target group)',
        lines: [
          'HealthyHostCount      02:00 4   02:05 4   02:10 0   02:15 0',
          'UnHealthyHostCount    02:00 0   02:05 0   02:10 4   02:15 4',
          'HTTPCode_ELB_5XX_Count 02:10–02:25  3,412',
          'TargetResponseTime    no data since 02:10',
          'CPUUtilization (app-asg) 02:15  31% (servers are idle, not overloaded)',
        ],
      },
      {
        id: 'cloudtrail',
        kind: 'cloudtrail',
        title: 'CloudTrail (management events)',
        lines: [
          '02:04:51Z CreateNetworkAcl          user/netops-jo   vpc-prod → acl-app "app-nacl"',
          '02:06:13Z CreateNetworkAclEntry     user/netops-jo   acl-app ingress  rule 100 tcp 443 10.0.0.0/23 allow',
          '02:06:40Z CreateNetworkAclEntry     user/netops-jo   acl-app ingress  rule 110 tcp 1024-65535 0.0.0.0/0 allow',
          '02:07:22Z CreateNetworkAclEntry     user/netops-jo   acl-app egress   rule 100 tcp 3306 10.0.20.0/23 allow',
          '02:07:58Z CreateNetworkAclEntry     user/netops-jo   acl-app egress   rule 110 tcp 443 0.0.0.0/0 allow',
          '02:09:30Z ReplaceNetworkAclAssociation user/netops-jo app-a, app-b → acl-app',
        ],
      },
    ],
    rootCause: 'nacl:acl-app:outbound',
    rootCauseExplain:
      "The app-nacl outbound rules only allow 3306 to the database and 443 to the internet. The app's responses to the load balancer leave from port 443 to the ALB node's ephemeral port (1024-65535), and nothing allows that, so the implicit * rule drops them. NACLs are stateless: allowing the request in does not allow the response out. Health checks time out the same way, so the target group is 0/4 healthy, the ALB fails open, and clients wait for a 504.",
    symptomEvents: ['reach'],
    allowedChanges: ['nacl:acl-app:outbound'],
    wrongFixes: [
      {
        name: 'Allow all traffic in and out on the NACL',
        board: start().naclRule('acl-app', 'inbound', rule(50, 'all', [0, 65535], '0.0.0.0/0')).naclRule('acl-app', 'outbound', rule(50, 'all', [0, 65535], '0.0.0.0/0')).done(),
        expectFail: [],
        collateral: true,
      },
      { name: 'Put the app subnets back on the default NACL', board: start().associate('app-a', 'naclId', 'nacl-default').associate('app-b', 'naclId', 'nacl-default').done(), expectFail: [], collateral: true },
      { name: 'Add another inbound rule (wrong direction)', board: start().naclRule('acl-app', 'inbound', rule(120, 'tcp', [1024, 65535], '10.0.0.0/23')).done(), expectFail: ['reach'], collateral: true },
    ],
  },
  questions: ['q-inc1-1', 'q-inc1-2', 'q-inc1-3'],
  concepts: ['nacls', 'sg-vs-nacl', 'vpc-flow-logs', 'alb-error-codes'],
  reference: start().naclRule('acl-app', 'outbound', rule(120, 'tcp', [1024, 65535], '10.0.0.0/23')).done(),
  keywords: ['stateless', 'ephemeral ports', 'connection times out', '504 Gateway Timeout', 'VPC Flow Logs REJECT'],
  hints: ['Read the flow logs: which direction is REJECTed?', 'Run a trace from the internet to the load balancer and watch the return path'],
};

