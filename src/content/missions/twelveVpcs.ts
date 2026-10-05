import type { Mission, VpcLayout, VpcSpec } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

const vpc = (key: string, octet: number, accountId: string): VpcSpec => ({
  id: `vpc-${key}`,
  name: key,
  cidr: `10.${octet}.0.0/16`,
  accountId,
  azs: [{ id: 'us-east-1a', name: 'us-east-1a' }],
  routeTables: [{ id: `rtb-${key}`, name: `rtb-${key}`, routes: [] }],
  subnets: [{ id: `${key}-a`, name: `${key}-a`, cidr: `10.${octet}.10.0/24`, az: 'us-east-1a', tier: 'app', routeTableId: `rtb-${key}` }],
});

const ACCOUNTS = { shared: '111122223333', prod: '222233334444', dev: '333344445555' };

const layout: VpcLayout = {
  regionId: 'us-east-1',
  regionName: 'US East (N. Virginia)',
  vpc: vpc('shared', 0, ACCOUNTS.shared),
  extraVpcs: [
    { regionId: 'us-east-1', regionName: 'US East (N. Virginia)', vpc: vpc('prod', 1, ACCOUNTS.prod) },
    { regionId: 'us-east-1', regionName: 'US East (N. Virginia)', vpc: vpc('dev', 2, ACCOUNTS.dev) },
  ],
  onprem: { name: 'Corporate data centre', cidr: '192.168.0.0/16', internetMbps: 1000 },
};

const ONPREM = '192.168.0.0/16';

/** The servers: a directory in the shared-services VPC, an app in prod and one in dev. */
function servers(): BoardBuilder {
  return new BoardBuilder(layout, 'bare')
    .place('ec2', 'shared-a', { name: 'directory' })
    .sgRule('directory', 'inbound', { protocol: 'tcp', fromPort: 636, toPort: 636, source: { cidr: '10.0.0.0/8' } })
    .sgRule('directory', 'inbound', { protocol: 'tcp', fromPort: 636, toPort: 636, source: { cidr: ONPREM } })
    .account('directory', ACCOUNTS.shared)
    .place('ec2', 'prod-a', { name: 'prod-app' })
    .sgRule('prod-app', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '10.0.0.0/8' } })
    .sgRule('prod-app', 'inbound', { protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: ONPREM } })
    .account('prod-app', ACCOUNTS.prod)
    .place('ec2', 'dev-a', { name: 'dev-app' })
    .account('dev-app', ACCOUNTS.dev)
    .place('cgw', '', { name: 'dc-router' });
}

type Rt = { id: string; name: string; associations: string[]; propagations: string[]; routes: { dest: string; attachment: string }[] };
const SEGMENTED: Rt[] = [
  { id: 'rt-prod', name: 'rt-prod', associations: ['vpc-prod'], propagations: ['vpc-shared', 'dc-vpn'], routes: [] },
  { id: 'rt-dev', name: 'rt-dev', associations: ['vpc-dev'], propagations: ['vpc-shared'], routes: [] },
  { id: 'rt-shared', name: 'rt-shared', associations: ['vpc-shared', 'dc-vpn'], propagations: ['vpc-shared', 'vpc-prod', 'vpc-dev', 'dc-vpn'], routes: [] },
];

function withTgw(rts: Rt[] = SEGMENTED): BoardBuilder {
  const b = servers()
    .place('tgw', 'us-east-1', { name: 'core-tgw' })
    .config('core-tgw', { vpcAttachments: ['vpc-shared', 'vpc-prod', 'vpc-dev'], ramShared: true })
    .place('vpn', '', { name: 'dc-vpn' })
    .config('dc-vpn', { cgwId: 'dc-router', attachTo: 'core-tgw' })
    .config('core-tgw', { routeTables: rts });
  for (const k of ['shared', 'prod', 'dev']) b.route(`rtb-${k}`, '10.0.0.0/8', { tgwName: 'core-tgw' }).route(`rtb-${k}`, ONPREM, { tgwName: 'core-tgw' });
  return b;
}

const reference = () => withTgw();

const ev = (from: string, to: string, port: number, expect: 'allow' | 'deny', label: Record<string, string>) => ({ from, to, port, expect, label });

export const twelveVpcs: Mission = {
  id: 'twelve-vpcs',
  stage: 3,
  mode: 'build',
  title: 'Spaghetti peering',
  client: 'Halyard Insurance, platform team',
  users: 'Three AWS accounts today (shared services, prod, dev), twelve VPCs by next year, and a corporate data centre',
  brief:
    "Every new VPC means another round of peering connections and route edits, and last month someone peered dev straight into prod. We want one hub that scales to dozens of VPCs. Prod and dev both use the directory in shared services, the data centre reaches prod and shared services, and dev must never reach prod. The prod and dev VPCs live in other accounts.",
  requirements: [
    { id: 'r1', text: 'Prod and dev both reach the directory (LDAPS, 636) in shared services' },
    { id: 'r2', text: 'Dev can never reach prod' },
    { id: 'r3', text: 'The data centre reaches prod and shared services' },
    { id: 'r4', text: 'Monthly bill under $400', target: { budget: 400 } },
  ],
  budget: 400,
  usage: { requestsPerMonth: 0, dataOutGb: 0, s3StorageGb: 0, s3GetRequests: 0, s3PutRequests: 0, flows: [], interVpcGb: 2000, hybridOutGb: 500 },
  defaults: 'bare',
  layout,
  palette: ['ec2', 'tgw', 'pcx', 'vgw', 'cgw', 'vpn', 'dx'],
  events: [
    { id: 'prod-shared', name: 'Prod signs in', desc: 'The prod app looks a user up in the directory (LDAPS, 636).', domain: 'secure', concepts: ['transit-gateway', 'route-blackholes'], kind: 'reachability', params: ev('ec2#vpc-prod', 'ec2#vpc-shared', 636, 'allow', { from: 'the prod app', to: 'the directory' }), requirementIds: ['r1'] },
    { id: 'dev-shared', name: 'Dev signs in', desc: 'The dev app looks a user up in the directory.', domain: 'secure', concepts: ['transit-gateway', 'route-blackholes'], kind: 'reachability', params: ev('ec2#vpc-dev', 'ec2#vpc-shared', 636, 'allow', { from: 'the dev app', to: 'the directory' }), requirementIds: ['r1'] },
    { id: 'dev-prod', name: 'A developer pokes prod', desc: 'A dev server tries to open HTTPS to the prod app. The prod security group allows 10.0.0.0/8, so only routing can stop it.', domain: 'secure', concepts: ['transit-gateway', 'vpc-peering'], kind: 'reachability', params: ev('ec2#vpc-dev', 'ec2#vpc-prod', 443, 'deny', { from: 'the dev app', to: 'the prod app' }), requirementIds: ['r2'] },
    { id: 'onprem-prod', name: 'Claims staff open prod', desc: 'HTTPS from the data centre to the prod app.', domain: 'secure', concepts: ['transit-gateway', 'site-to-site-vpn'], kind: 'reachability', params: ev('onprem', 'ec2#vpc-prod', 443, 'allow', { from: 'the data centre', to: 'the prod app' }), requirementIds: ['r3'] },
    { id: 'onprem-shared', name: 'Data centre syncs the directory', desc: 'LDAPS from the data centre to the directory.', domain: 'secure', concepts: ['transit-gateway', 'site-to-site-vpn'], kind: 'reachability', params: ev('onprem', 'ec2#vpc-shared', 636, 'allow', { from: 'the data centre', to: 'the directory' }), requirementIds: ['r3'] },
    { id: 'bill', name: 'Monthly bill', desc: 'Attachment hours, 2 TB a month between VPCs and the VPN.', domain: 'cost', concepts: ['transit-gateway', 'data-transfer-costs'], kind: 'bill', params: {}, requirementIds: ['r4'], passesOnEmptyBoard: true },
  ],
  questions: ['q-tg-1', 'q-tg-2', 'q-tg-3', 'q-tg-4', 'q-tg-5'],
  concepts: ['transit-gateway', 'vpc-peering', 'site-to-site-vpn', 'route-blackholes', 'aws-organizations'],
  reference: reference().done(),
  mistakes: [
    {
      name: 'Peering hub with the VPN on shared services',
      board: servers()
        .place('pcx', 'vpc-shared', { name: 'shared-prod' })
        .config('shared-prod', { peerVpcId: 'vpc-prod' })
        .place('pcx', 'vpc-shared', { name: 'shared-dev' })
        .config('shared-dev', { peerVpcId: 'vpc-dev' })
        .place('vgw', 'vpc-shared', { name: 'shared-vgw' })
        .place('vpn', '', { name: 'dc-vpn' })
        .config('dc-vpn', { cgwId: 'dc-router', attachTo: 'shared-vgw' })
        .route('rtb-shared', '10.1.0.0/16', { pcxName: 'shared-prod' })
        .route('rtb-shared', '10.2.0.0/16', { pcxName: 'shared-dev' })
        .route('rtb-shared', ONPREM, { vgwName: 'shared-vgw' })
        .route('rtb-prod', '10.0.0.0/16', { pcxName: 'shared-prod' })
        .route('rtb-prod', ONPREM, { pcxName: 'shared-prod' })
        .route('rtb-dev', '10.0.0.0/16', { pcxName: 'shared-dev' })
        .done(),
      expectFail: ['onprem-prod'],
    },
    {
      name: 'One TGW route table for everything',
      board: withTgw([{ id: 'tgw-rtb-default', name: 'default', associations: ['vpc-shared', 'vpc-prod', 'vpc-dev', 'dc-vpn'], propagations: ['vpc-shared', 'vpc-prod', 'vpc-dev', 'dc-vpn'], routes: [] }]).done(),
      expectFail: ['dev-prod'],
    },
    { name: 'Shared services VPC has no route back', board: reference().removeRoute('rtb-shared', '10.0.0.0/8').done(), expectFail: ['prod-shared', 'dev-shared'] },
    {
      name: 'VPN not propagated into the prod route table',
      board: withTgw(SEGMENTED.map((rt) => (rt.id === 'rt-prod' ? { ...rt, propagations: ['vpc-shared'] } : rt))).done(),
      expectFail: ['onprem-prod'],
    },
  ],
  keywords: ['hub-and-spoke → Transit Gateway', 'VPC peering is not transitive', 'isolate VPCs → separate TGW route tables', 'share the TGW across accounts → AWS RAM', 'thousands of VPCs'],
  hints: ['A transit gateway attached to all three VPCs, shared through RAM', 'The VPN attached to the transit gateway', 'Separate TGW route tables for prod, dev and shared services', 'VPC routes for 10.0.0.0/8 and the data centre'],
};
