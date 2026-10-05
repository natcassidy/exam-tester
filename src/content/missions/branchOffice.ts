import type { Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

const layout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  vpc: {
    id: 'vpc-payroll',
    name: 'payroll',
    cidr: '10.0.0.0/16',
    azs: [
      { id: 'us-east-1a', name: 'us-east-1a' },
      { id: 'us-east-1b', name: 'us-east-1b' },
    ],
    routeTables: [{ id: 'rtb-private', name: 'rtb-private', routes: [] }],
    subnets: [
      { id: 'app-a', name: 'app-a', cidr: '10.0.10.0/24', az: 'us-east-1a', tier: 'app', routeTableId: 'rtb-private' },
      { id: 'app-b', name: 'app-b', cidr: '10.0.11.0/24', az: 'us-east-1b', tier: 'app', routeTableId: 'rtb-private' },
    ],
  },
  onprem: { name: 'Head office', cidr: '192.168.0.0/16', internetMbps: 500 },
};

function base(): BoardBuilder {
  return new BoardBuilder(layout, 'bare')
    .place('ec2', 'app-a', { name: 'payroll-app' })
    .sgRule('payroll-app', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '192.168.0.0/16' } })
    .place('vgw', 'vpc-payroll', { name: 'payroll-vgw' })
    .route('rtb-private', '192.168.0.0/16', { vgwName: 'payroll-vgw' });
}

const vpn = (b: BoardBuilder) => b.place('cgw', '', { name: 'office-router' }).place('vpn', '', { name: 'office-vpn' }).config('office-vpn', { cgwId: 'office-router', attachTo: 'payroll-vgw' });
const dx = (b: BoardBuilder, encryption: 'none' | 'ipsec-vpn' = 'ipsec-vpn') => b.place('dx', '', { name: 'office-dx' }).config('office-dx', { speedGbps: 1, attachTo: 'payroll-vgw', encryption });

const reference = () => dx(vpn(base()));

const to = { to: 'ec2', port: 443, label: 'the payroll app' };

export const branchOffice: Mission = {
  id: 'branch-office',
  stage: 3,
  mode: 'build',
  title: 'Payroll by Friday',
  client: 'Calder & Finch, a 400-person engineering firm',
  users: 'Office staff reaching a payroll app in AWS; a nightly 1 Gbps sync of timesheets',
  brief:
    "We moved payroll into a private VPC in AWS. Head office has to reach it by tomorrow morning because payday is Friday. After that, finance wants the nightly timesheet sync on a consistent 1 Gbps link, not 'whatever the internet gives us', and compliance says payroll data is encrypted on the wire, always. If the main link fails, payroll can't stop.",
  requirements: [
    { id: 'r1', text: 'Head office reaches the payroll app by tomorrow' },
    { id: 'r2', text: 'Consistent 1 Gbps for the nightly sync' },
    { id: 'r3', text: 'Traffic encrypted in transit' },
    { id: 'r4', text: 'Survives the main link failing' },
    { id: 'r5', text: 'Monthly bill under $400', target: { budget: 400 } },
  ],
  budget: 400,
  usage: { requestsPerMonth: 0, dataOutGb: 0, s3StorageGb: 0, s3GetRequests: 0, s3PutRequests: 0, flows: [], hybridOutGb: 2000 },
  defaults: 'bare',
  layout,
  palette: ['ec2', 'vgw', 'cgw', 'vpn', 'dx', 'tgw', 'nat'],
  events: [
    { id: 'within', name: 'Tomorrow morning', desc: 'Head office opens the payroll app. Only links that can be up within a day count.', domain: 'resilient', concepts: ['site-to-site-vpn', 'hybrid-connectivity'], kind: 'connectivity', params: { check: 'within', withinDays: 1, ...to }, requirementIds: ['r1'] },
    { id: 'reach', name: 'Clerk opens payroll', desc: 'HTTPS from an office desktop to the payroll app, and the reply back.', domain: 'secure', concepts: ['site-to-site-vpn', 'route-blackholes'], kind: 'reachability', params: { from: 'onprem', to: 'ec2', port: 443, expect: 'allow', label: { from: 'head office', to: 'the payroll app' } }, requirementIds: ['r1'] },
    { id: 'bandwidth', name: 'Nightly timesheet sync', desc: 'A 1 Gbps sync that must not slow down when the internet is busy.', domain: 'performant', concepts: ['direct-connect', 'hybrid-connectivity'], kind: 'connectivity', params: { check: 'bandwidth', gbps: 1, ...to }, requirementIds: ['r2'] },
    { id: 'encrypted', name: 'Compliance review', desc: 'The auditor checks the link that actually carries payroll traffic.', domain: 'secure', concepts: ['direct-connect', 'site-to-site-vpn'], kind: 'connectivity', params: { check: 'encrypted', ...to }, requirementIds: ['r3'] },
    { id: 'failover', name: 'Backhoe cuts the fibre', desc: 'The Direct Connect circuit goes down mid-morning.', domain: 'resilient', concepts: ['hybrid-connectivity', 'site-to-site-vpn'], kind: 'connectivity', params: { check: 'failover', failLink: 'dx', ...to }, requirementIds: ['r4'] },
    { id: 'bill', name: 'Monthly bill', desc: 'Ports, VPN connection hours and 2 TB a month back to the office.', domain: 'cost', concepts: ['direct-connect', 'data-transfer-costs'], kind: 'bill', params: {}, requirementIds: ['r5'], passesOnEmptyBoard: true },
  ],
  questions: ['q-bo-1', 'q-bo-2', 'q-bo-3', 'q-bo-4', 'q-bo-5'],
  concepts: ['site-to-site-vpn', 'direct-connect', 'hybrid-connectivity', 'route-blackholes', 'transit-gateway'],
  reference: reference().done(),
  mistakes: [
    { name: 'Direct Connect only', board: dx(base()).done(), expectFail: ['within', 'failover'] },
    { name: 'VPN only', board: vpn(base()).done(), expectFail: ['bandwidth', 'failover'] },
    { name: 'Direct Connect without encryption', board: dx(vpn(base()), 'none').done(), expectFail: ['encrypted'] },
    { name: 'No route back to the office', board: reference().removeRoute('rtb-private', '192.168.0.0/16').done(), expectFail: ['within', 'reach', 'bandwidth', 'encrypted', 'failover'] },
  ],
  keywords: ['connect on-premises quickly → Site-to-Site VPN', 'consistent network performance → Direct Connect', 'encrypt Direct Connect → IPsec VPN over DX or MACsec', 'backup for Direct Connect → VPN'],
  hints: ['A virtual private gateway on the VPC', 'A customer gateway and a Site-to-Site VPN for day one', 'A Direct Connect connection for the steady 1 Gbps', 'A route back to the office network'],
};
