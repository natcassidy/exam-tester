import type { Mission } from '../../engine/model';
import type { BoardBuilder } from '../../engine/builder';
import { ev, incidentBase, prodLayout, threeTier } from './shared';

/** Someone deleted nat-a. The route in rtb-private-a still points at it: a blackhole. */
function start(): BoardBuilder {
  return threeTier().remove('nat-a');
}

const startingBoard = start().done();
const deletedNat = threeTier().id('nat-a');

export const patchIncident: Mission = {
  ...incidentBase(),
  id: 'inc-patch',
  title: 'Patch Tuesday, again',
  client: 'Ledgerly operations',
  users: 'Half the app fleet',
  palette: ['nat'],
  brief:
    "Patch day. The servers in us-east-1b updated fine, but every server in us-east-1a fails to download anything: 'Connection timed out'. Customers aren't affected yet, but the security team wants every server patched today. Two days ago an intern was 'cleaning up unused resources' in the console.",
  requirements: [
    { id: 'r1', text: 'Every app server can download patches again' },
    { id: 'r2', text: 'Losing one AZ must not cut the other AZ off from the internet' },
    { id: 'r3', text: 'App servers stay private (audit)' },
  ],
  layout: prodLayout,
  startingBoard,
  events: [
    ev.reach(['r1']),
    ev.patch(['r1']),
    { id: 'az-outage', name: 'us-east-1b goes dark', desc: 'An AZ failure takes out us-east-1b at 300 rps. Servers in us-east-1a must keep their outbound access.', domain: 'resilient', concepts: ['nat-gateway', 'route-blackholes'], kind: 'azOutage', params: { az: 'us-east-1b', loadRps: 300, rtoSec: 300, rpoSec: 60, requireOutbound: true }, requirementIds: ['r2'] },
    ev.audit(['appTierPrivate', 'noSshFromWorld', 'dbNotPublic'], ['r3']),
  ],
  incident: {
    alert: { title: 'Patch job failing in us-east-1a', detail: 'yum: Connection timed out on 2/4 instances (all in us-east-1a) · us-east-1b instances patched OK' },
    budget: 8,
    par: 3,
    logs: [
      {
        id: 'app',
        kind: 'app',
        title: 'Patch job output (Systems Manager Run Command)',
        lines: [
          'i-0a11 (us-east-1a, 10.0.10.21)  Failed   Cannot retrieve repository metadata: Connection timed out after 30001 ms',
          'i-0a12 (us-east-1a, 10.0.10.28)  Failed   Cannot retrieve repository metadata: Connection timed out after 30000 ms',
          'i-0b21 (us-east-1b, 10.0.11.35)  Success  14 packages updated',
          'i-0b22 (us-east-1b, 10.0.11.42)  Success  14 packages updated',
        ],
      },
      {
        id: 'cloudwatch',
        kind: 'cloudwatch',
        title: 'CloudWatch metrics (NAT gateways)',
        lines: [
          'nat-b  BytesOutToDestination   last 24 h  6.1 GB',
          'nat-b  ActiveConnectionCount   now        212',
          'nat-a  (no data for 2 days: the resource no longer exists)',
        ],
      },
      {
        id: 'cloudtrail',
        kind: 'cloudtrail',
        title: 'CloudTrail (management events)',
        lines: [
          `2 days ago 16:42:10Z DeleteNatGateway     user/intern-sam  natGatewayId ${deletedNat} (Name: nat-a)`,
          '2 days ago 16:44:57Z ReleaseAddress       user/intern-sam  allocationId eipalloc-0a7 (nat-a\'s Elastic IP)',
          '2 days ago 16:45:30Z TerminateInstances   user/intern-sam  i-0old-bastion',
        ],
      },
    ],
    rootCause: 'route:rtb-private-a:0.0.0.0/0',
    rootCauseExplain:
      `rtb-private-a still sends 0.0.0.0/0 to nat-a (${deletedNat}), which was deleted two days ago. AWS keeps the route and marks it as a blackhole: packets that match it are dropped. Only the subnets associated with rtb-private-a (app-a and data-a) are affected; rtb-private-b uses nat-b, which still exists.`,
    symptomEvents: ['patch'],
    allowedChanges: ['route:rtb-private-a:0.0.0.0/0', 'add:nat'],
    wrongFixes: [
      { name: 'Point rtb-private-a at nat-b (in the other AZ)', board: start().route('rtb-private-a', '0.0.0.0/0', { natName: 'nat-b' }).done(), expectFail: ['az-outage'], collateral: false },
      { name: 'Give app servers public IPs and route them to the internet gateway', board: start().config('app-asg', { publicIp: true }).route('rtb-private-a', '0.0.0.0/0', { igwName: 'igw-1' }).done(), expectFail: ['audit'], collateral: true },
      { name: 'Delete the blackhole route', board: start().removeRoute('rtb-private-a', '0.0.0.0/0').done(), expectFail: ['patch'], collateral: false },
    ],
  },
  questions: ['q-inc2-1', 'q-inc2-2', 'q-inc2-3'],
  concepts: ['nat-gateway', 'route-blackholes', 'cloudtrail', 'vpc-public-private'],
  reference: start().place('nat', 'public-a', { name: 'nat-a2' }).route('rtb-private-a', '0.0.0.0/0', { natName: 'nat-a2' }).done(),
  keywords: ['blackhole route', 'only one AZ affected', 'NAT gateway per AZ', 'who deleted it? → CloudTrail'],
  hints: ['Which instances fail, and what do they have in common?', 'Open the route table those subnets use'],
};
