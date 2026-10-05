import type { Mission } from '../../engine/model';
import type { BoardBuilder } from '../../engine/builder';
import { ev, incidentBase, prodLayout, threeTier } from './shared';

const HC = { path: '/health', intervalSec: 30, timeoutSec: 5, healthyThreshold: 5, unhealthyThreshold: 2 };

/** The new release moved the health endpoint to /healthz. The target group still asks for /health. */
function start(): BoardBuilder {
  return threeTier().config('app-asg', { app: { port: 443, healthPath: '/healthz' } }).config('web-alb', { healthCheck: HC });
}

const startingBoard = start().done();
const b = start();
const albId = b.id('web-alb');
const asgId = b.id('app-asg');

export const healthIncident: Mission = {
  ...incidentBase(),
  id: 'inc-health',
  title: '0/4 healthy',
  client: 'Tillpoint, point-of-sale API',
  users: '1,800 shops, card terminals retry for 30 s',
  brief:
    "Since this morning's release, the load balancer says no target is healthy. Oddly, most requests still work, but every few minutes everything fails for a couple of minutes and Auto Scaling keeps launching new servers. The developers swear the new build is fine. It is: they just tidied up some URLs.",
  requirements: [
    { id: 'r1', text: 'Every target passes its health check' },
    { id: 'r2', text: 'No replacement loop: errors stay under 1%' },
    { id: 'r3', text: 'The app still reaches its database' },
  ],
  layout: prodLayout,
  startingBoard,
  events: [
    ev.reach(['r1']),
    { id: 'fleet', name: 'An hour of normal trading', desc: '600 rps for 30 minutes while the load balancer health-checks the fleet and Auto Scaling acts on the results.', domain: 'resilient', concepts: ['alb-health-checks', 'asg-health-checks', 'alb-error-codes'], kind: 'fleetHealth', params: { entry: 'alb', loadRps: 600, durationMin: 30, appBootSec: 120, slo: { errorRate: 0.01 } }, requirementIds: ['r1', 'r2'] },
    ev.appDb(['r3']),
  ],
  incident: {
    alert: { title: 'Target group 0/4 healthy', detail: 'web-alb · Auto Scaling replaced 36 instances in the last hour · intermittent HTTP 503' },
    budget: 8,
    par: 3,
    logs: [
      {
        id: 'app',
        kind: 'app',
        title: 'App access log (one instance)',
        lines: [
          '10.0.0.14 - - [05/Oct/2026:09:10:31 +0000] "GET /health HTTP/1.1" 404 9 "-" "ELB-HealthChecker/2.0"',
          '10.0.1.9  - - [05/Oct/2026:09:10:33 +0000] "GET /health HTTP/1.1" 404 9 "-" "ELB-HealthChecker/2.0"',
          '10.0.0.14 - - [05/Oct/2026:09:10:35 +0000] "POST /v2/payments HTTP/1.1" 200 412 "-" "Tillpoint-Terminal/5.1"',
          '10.0.0.14 - - [05/Oct/2026:09:11:01 +0000] "GET /health HTTP/1.1" 404 9 "-" "ELB-HealthChecker/2.0"',
          '# Release notes v5.0: "Renamed /health to /healthz to match the Kubernetes convention."',
        ],
      },
      {
        id: 'alb',
        kind: 'alb',
        title: 'ALB access logs (web-alb)',
        lines: [
          'https 09:12:02Z app/web-alb 198.51.100.23:40011 10.0.10.21:443 0.000 0.041 0.000 200 200 "POST /v2/payments"',
          'https 09:12:04Z app/web-alb 198.51.100.61:40102 10.0.11.35:443 0.000 0.038 0.000 200 200 "POST /v2/payments"',
          'https 09:13:40Z app/web-alb 198.51.100.23:40188 - -1 -1 -1 503 - "POST /v2/payments"',
          'https 09:13:41Z app/web-alb 198.51.100.90:51022 - -1 -1 -1 503 - "POST /v2/payments"',
          '# 503 with target "-": no target was registered at that moment.',
        ],
      },
      {
        id: 'asg',
        kind: 'cloudwatch',
        title: 'Auto Scaling activity history (app-asg)',
        lines: [
          '09:13:09Z Terminating EC2 instance: i-0c41  Cause: an instance was taken out of service in response to an ELB system health check failure.',
          '09:13:09Z Terminating EC2 instance: i-0c42  Cause: an instance was taken out of service in response to an ELB system health check failure.',
          '09:13:11Z Launching a new EC2 instance: i-0c51  Cause: an instance was started in response to a difference between desired and actual capacity, increasing the capacity from 2 to 4.',
          '09:08:02Z Terminating EC2 instance: i-0b97  Cause: … ELB system health check failure.',
        ],
      },
      {
        id: 'cloudwatch',
        kind: 'cloudwatch',
        title: 'CloudWatch metrics (target group)',
        lines: ['HealthyHostCount    0 since 08:31 (release time)', 'UnHealthyHostCount  2–4', 'HTTPCode_ELB_503_Count  spikes every ~6 min', 'CPUUtilization (app-asg) 35–55%'],
      },
    ],
    rootCause: `config:${albId}:healthCheck`,
    rootCauseExplain:
      "The target group health check still requests /health, but the new release serves /healthz, so every check gets a 404 and every target is unhealthy. With no healthy target the ALB fails open, which is why most requests still work. But the Auto Scaling group uses ELB health checks, so after each grace period it terminates the 'unhealthy' instances and launches new ones, and while they boot nothing is registered: HTTP 503.",
    symptomEvents: ['fleet'],
    allowedChanges: [`config:${albId}:healthCheck`, `config:${asgId}:app`],
    wrongFixes: [
      { name: 'Switch the Auto Scaling group to EC2 health checks', board: start().config('app-asg', { healthCheckType: 'EC2' }).done(), expectFail: ['fleet'], collateral: true },
      { name: 'Raise the unhealthy threshold to 10', board: start().config('web-alb', { healthCheck: { ...HC, unhealthyThreshold: 10 } }).done(), expectFail: ['fleet'], collateral: false },
      { name: 'Double the fleet', board: start().config('app-asg', { min: 8, desired: 8, max: 12 }).done(), expectFail: ['fleet'], collateral: true },
    ],
  },
  questions: ['q-inc3-1', 'q-inc3-2', 'q-inc3-3'],
  concepts: ['alb-health-checks', 'asg-health-checks', 'alb-error-codes'],
  reference: start().config('web-alb', { healthCheck: { ...HC, path: '/healthz' } }).done(),
  keywords: ['0 healthy targets', 'fail open', 'instances keep being replaced', '503 Service Unavailable', 'ELB health checks'],
  hints: ['Who is asking for /health, and what do they get back?'],
};
