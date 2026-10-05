import type { Mission } from '../../engine/model';
import type { BoardBuilder } from '../../engine/builder';
import { ev, incidentBase, prodLayout, threeTier } from './shared';

const isDbFromApp = () => true;

/** A Terraform refactor rewrote db-sg: 3306 is now allowed from the ALB's security group. */
function start(): BoardBuilder {
  return threeTier()
    .dropSgRules('app-db', 'inbound', isDbFromApp)
    .sgRule('app-db', 'inbound', { protocol: 'tcp', fromPort: 3306, toPort: 3306, source: { sgOf: 'web-alb' }, description: 'MySQL from web tier' });
}

const startingBoard = start().done();
const dbSg = start().sgOf('app-db');

export const doorIncident: Mission = {
  ...incidentBase(),
  id: 'inc-door',
  title: 'The wrong door',
  client: 'Ledgerly, after a Terraform refactor',
  users: 'Every logged-in customer',
  brief:
    "The infrastructure team merged a 'security group cleanup' an hour ago. Now every page that touches the database returns HTTP 500, and the app logs say it can't connect to MySQL. The database itself is healthy: CPU is idle and the monitoring user can still log in from the bastion.",
  requirements: [
    { id: 'r1', text: 'The app reaches the database again' },
    { id: 'r2', text: 'The database is still unreachable from the internet' },
    { id: 'r3', text: 'Only the app tier can reach the database (audit)' },
  ],
  layout: prodLayout,
  startingBoard,
  events: [ev.reach(['r1']), ev.appDb(['r1']), ev.dbPrivate(['r2']), ev.audit(['dbSgLeastPrivilege', 'privateTierSgsChained', 'dbNotPublic'], ['r3'])],
  incident: {
    alert: { title: 'HTTP 500 on every database page', detail: "app logs: ERROR 2003 (HY000): Can't connect to MySQL server (110 Connection timed out)" },
    budget: 8,
    par: 3,
    logs: [
      {
        id: 'app',
        kind: 'app',
        title: 'App error log',
        lines: [
          "2026-10-05 11:02:14 ERROR pool: ERROR 2003 (HY000): Can't connect to MySQL server on 'app-db.c9x1.us-east-1.rds.amazonaws.com:3306' (110)",
          "2026-10-05 11:02:44 ERROR pool: ERROR 2003 (HY000): Can't connect to MySQL server on 'app-db.c9x1.us-east-1.rds.amazonaws.com:3306' (110)",
          '# errno 110 = connection timed out: packets are silently dropped (a refused connection would be errno 111).',
        ],
      },
      {
        id: 'flow',
        kind: 'flow',
        title: 'VPC Flow Logs (app-db ENI eni-0db1)',
        lines: [
          '2 111122223333 eni-0db1 10.0.10.21 10.0.20.40 51544 3306 6 3 180 1759662120 1759662180 REJECT OK',
          '2 111122223333 eni-0db1 10.0.11.35 10.0.20.40 40021 3306 6 3 180 1759662120 1759662180 REJECT OK',
          '# Every connection from the app subnets (10.0.10.x, 10.0.11.x) is REJECTed at the database ENI. Data subnets use the default NACL (allow all), so this is the security group.',
        ],
      },
      {
        id: 'cloudtrail',
        kind: 'cloudtrail',
        title: 'CloudTrail (management events)',
        lines: [
          `10:58:01Z RevokeSecurityGroupIngress     role/terraform-ci  ${dbSg} tcp 3306 from sg (app-sg)`,
          `10:58:02Z AuthorizeSecurityGroupIngress  role/terraform-ci  ${dbSg} tcp 3306 from sg (alb-sg) "MySQL from web tier"`,
          '# commit 4f2c1e: "consolidate SG references: web tier → db"',
        ],
      },
    ],
    rootCause: `sg:${dbSg}:inbound`,
    rootCauseExplain:
      "db-sg allows 3306 from alb-sg, the load balancer's security group, instead of app-sg. Security group references match the security groups attached to the sender's network interface. The app instances carry app-sg, so their connections match nothing and are dropped silently (a timeout, errno 110). Meanwhile the load balancer, which never talks to the database, is allowed in.",
    symptomEvents: ['app-db', 'audit'],
    allowedChanges: [`sg:${dbSg}:inbound`],
    wrongFixes: [
      { name: 'Allow 3306 from the whole VPC CIDR', board: start().sgRule('app-db', 'inbound', { protocol: 'tcp', fromPort: 3306, toPort: 3306, source: { cidr: '10.0.0.0/16' } }).done(), expectFail: ['audit'], collateral: false },
      { name: 'Add app-sg but leave the ALB rule in place', board: start().sgRule('app-db', 'inbound', { protocol: 'tcp', fromPort: 3306, toPort: 3306, source: { sgOf: 'app-asg' } }).done(), expectFail: ['audit'], collateral: false },
      { name: 'Open 3306 to 0.0.0.0/0 "temporarily"', board: start().sgRule('app-db', 'inbound', { protocol: 'tcp', fromPort: 3306, toPort: 3306, source: { cidr: '0.0.0.0/0' } }).done(), expectFail: ['audit'], collateral: true },
    ],
  },
  questions: ['q-inc4-1', 'q-inc4-2', 'q-inc4-3'],
  concepts: ['sg-chaining', 'security-groups', 'vpc-flow-logs'],
  reference: start()
    .dropSgRules('app-db', 'inbound', isDbFromApp)
    .sgRule('app-db', 'inbound', { protocol: 'tcp', fromPort: 3306, toPort: 3306, source: { sgOf: 'app-asg' }, description: 'MySQL from the app tier' })
    .done(),
  keywords: ['security group referencing', 'least privilege', 'connection timed out', 'only the application tier may access the database'],
  hints: ['Which security group do the app instances carry?'],
};
