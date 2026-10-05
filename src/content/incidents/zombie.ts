import type { Mission } from '../../engine/model';
import type { BoardBuilder } from '../../engine/builder';
import { ev, incidentBase, prodLayout, threeTier } from './shared';

/** The group was created years ago with the default EC2 health check type. */
function start(): BoardBuilder {
  return threeTier().config('app-asg', { min: 6, desired: 6, max: 10, healthCheckType: 'EC2', healthCheckGraceSec: 300 });
}

const startingBoard = start().done();
const asgId = start().id('app-asg');

export const zombieIncident: Mission = {
  ...incidentBase(),
  id: 'inc-zombie',
  title: 'The zombie fleet',
  client: 'Courierly, delivery tracking API',
  users: '1,300 rps at lunchtime',
  brief:
    "For three days, lunchtime latency has been terrible and some tracking requests fail. Auto Scaling insists all six instances are InService and EC2 status checks are green on every one. The load balancer disagrees: it says two of them are unhealthy. Nobody has restarted anything because 'AWS would have replaced them if they were broken'.",
  requirements: [
    { id: 'r1', text: 'Broken instances are replaced automatically' },
    { id: 'r2', text: 'Lunchtime peak: ≤ 2% errors and every target healthy' },
    { id: 'r3', text: 'Customers still reach the API' },
  ],
  layout: prodLayout,
  startingBoard,
  events: [
    ev.reach(['r3']),
    { id: 'fleet', name: 'Lunchtime peak with two crashed apps', desc: '1,300 rps for an hour. Two instances have a dead app process (out-of-memory kill) but a healthy OS.', domain: 'resilient', concepts: ['asg-health-checks', 'alb-health-checks'], kind: 'fleetHealth', params: { entry: 'alb', loadRps: 1300, durationMin: 60, crashed: 2, appBootSec: 120, slo: { errorRate: 0.02 } }, requirementIds: ['r1', 'r2'] },
    ev.appDb(['r3']),
  ],
  incident: {
    alert: { title: 'Target group 4/6 healthy for 3 days', detail: 'web-alb p95 TargetResponseTime 2.4 s at peak · Auto Scaling: 6/6 InService · EC2 status checks 2/2 passed' },
    budget: 8,
    par: 3,
    logs: [
      {
        id: 'cloudwatch',
        kind: 'cloudwatch',
        title: 'CloudWatch metrics',
        lines: [
          'web-alb  HealthyHostCount 4 · UnHealthyHostCount 2   (flat for 72 h)',
          'web-alb  TargetResponseTime p95  12:30  2.4 s',
          'web-alb  HTTPCode_ELB_5XX_Count  12:00–13:00  9,812',
          'app-asg  GroupInServiceInstances 6 · GroupDesiredCapacity 6',
          'EC2      StatusCheckFailed  0 on all six instances',
        ],
      },
      {
        id: 'app',
        kind: 'app',
        title: 'System log (i-0d23, one of the unhealthy targets)',
        lines: [
          'Oct 02 12:41:07 kernel: Out of memory: Killed process 2211 (java) total-vm:6144000kB',
          'Oct 02 12:41:07 systemd[1]: tracker.service: Main process exited, code=killed, status=9/KILL',
          'Oct 02 12:41:07 systemd[1]: tracker.service: Failed with result \'signal\'.',
          '# The OS is fine (status checks pass). Nothing is listening on 443 any more.',
        ],
      },
      {
        id: 'asg',
        kind: 'cloudwatch',
        title: 'Auto Scaling activity history (app-asg)',
        lines: ['(no activity in the last 72 hours)'],
      },
    ],
    rootCause: `config:${asgId}:healthCheckType`,
    rootCauseExplain:
      "The Auto Scaling group uses EC2 health checks, which only look at instance status (hardware, hypervisor, OS reachability). The app process on two instances was killed by the OOM killer, so the load balancer's health checks fail and it stops routing to them, but Auto Scaling never hears about it and never replaces them. The remaining four instances can't carry the lunchtime load. Switch the group to ELB health checks, with a grace period longer than the app's startup time.",
    symptomEvents: ['fleet'],
    allowedChanges: [`config:${asgId}:healthCheckType`, `config:${asgId}:healthCheckGraceSec`],
    wrongFixes: [
      { name: 'Add two more instances', board: start().config('app-asg', { min: 8, desired: 8, max: 10 }).done(), expectFail: ['fleet'], collateral: true },
      { name: 'ELB health checks with a 0-second grace period', board: start().config('app-asg', { healthCheckType: 'ELB', healthCheckGraceSec: 0 }).done(), expectFail: ['fleet'], collateral: false },
      { name: 'Lower the ALB unhealthy threshold', board: start().config('web-alb', { healthCheck: { path: '/health', intervalSec: 10, timeoutSec: 5, healthyThreshold: 2, unhealthyThreshold: 2 } }).done(), expectFail: ['fleet'], collateral: true },
    ],
  },
  questions: ['q-inc8-1', 'q-inc8-2', 'q-inc8-3'],
  concepts: ['asg-health-checks', 'alb-health-checks', 'cloudwatch-metrics'],
  reference: start().config('app-asg', { healthCheckType: 'ELB', healthCheckGraceSec: 300 }).done(),
  keywords: ['instances are not replaced', 'status checks pass but the app is down', 'ELB health check type', 'health check grace period'],
  hints: ['Who decides that an instance should be replaced, and what does it look at?'],
};
