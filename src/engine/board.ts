// Board operations: creation from a layout, placement, config edits and AWS-real validation.
// All functions are pure: they return a new board and never mutate the input.

import type {
  Board,
  Component,
  ComponentId,
  ConfigOf,
  Nacl,
  NaclRule,
  Placement,
  Route,
  RouteTarget,
  SecurityGroup,
  ServiceConfig,
  ServiceType,
  SgRule,
  Subnet,
  Vpc,
  VpcLayout,
  VpcSpec,
} from './model';
import { cidrContainsCidr, cidrsOverlap, hostIp, isCanonicalCidr, isValidCidr } from './net/cidr';
import { validateNaclRule } from './net/nacl';
import { allSubnets, findSubnet, isPublicSubnet, PREFIX_LISTS, subnetPublicStatus, targetId, targetKind } from './net/routing';

export type Defaults = 'helpful' | 'bare';

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function emptyBoard(): Board {
  return { regions: [], edge: [], components: {}, routeTables: {}, securityGroups: {}, nacls: {}, seq: 0 };
}

export function allowAllNacl(id: string, name: string, vpcId: string): Nacl {
  const all = (n: number): NaclRule => ({ ruleNumber: n, protocol: 'all', portRange: [0, 65535], cidr: '0.0.0.0/0', action: 'allow' });
  return { id, name, vpcId, inbound: [all(100)], outbound: [all(100)] };
}

export function createBoardFromLayout(layout: VpcLayout): Board {
  const board = emptyBoard();
  board.regions.push({ id: layout.regionId, name: layout.regionName, vpcs: [], regionalServices: [] });
  if (layout.vpc) addVpc(board, layout.regionId, layout.vpc, true);
  for (const x of layout.extraVpcs ?? []) {
    if (!board.regions.some((r) => r.id === x.regionId)) board.regions.push({ id: x.regionId, name: x.regionName, vpcs: [], regionalServices: [] });
    if (x.vpc) addVpc(board, x.regionId, x.vpc, false);
  }
  if (layout.onprem) board.onprem = { id: 'onprem', name: layout.onprem.name, cidr: layout.onprem.cidr, internetMbps: layout.onprem.internetMbps, components: [] };
  return board;
}

/** Default NACL id of a VPC: nacl-default for a mission's first VPC, nacl-default-<vpc> for the rest. */
export function defaultNaclId(board: Board, vpcId: string): string {
  const first = board.regions[0]?.vpcs[0];
  return !first || first.id === vpcId ? 'nacl-default' : `nacl-default-${vpcId}`;
}

function addVpc(board: Board, regionId: string, v: VpcSpec, first: boolean) {
  const region = board.regions.find((r) => r.id === regionId)!;
  const vpc: Vpc = { id: v.id, cidr: v.cidr, attachments: [], azs: v.azs.map((a) => ({ id: a.id, name: a.name, subnets: [] })) };
  if (v.name) vpc.name = v.name;
  if (v.accountId) vpc.accountId = v.accountId;
  region.vpcs.push(vpc);
  const defNacl = first ? 'nacl-default' : `nacl-default-${v.id}`;
  board.nacls[defNacl] = allowAllNacl(defNacl, first ? 'default-nacl' : `default-nacl (${v.name ?? v.id})`, v.id);
  for (const rt of v.routeTables) {
    board.routeTables[rt.id] = { id: rt.id, name: rt.name, vpcId: v.id, routes: [{ dest: v.cidr, target: 'local' }, ...clone(rt.routes)] };
  }
  for (const s of v.subnets) {
    const az = vpc.azs.find((a) => a.id === s.az);
    if (!az) throw new Error(`Layout subnet ${s.id} references unknown AZ ${s.az}`);
    const naclId = s.naclId ?? defNacl;
    if (!board.nacls[naclId]) board.nacls[naclId] = allowAllNacl(naclId, naclId, v.id);
    az.subnets.push({ id: s.id, name: s.name, cidr: s.cidr, azId: s.az, tier: s.tier, routeTableId: s.routeTableId, naclId, components: [] });
  }
  if (v.igw) {
    const igw = makeComponent(board, 'igw', { kind: 'vpcAttach', refId: v.id });
    igw.id = first ? 'igw-1' : `igw-${v.id}`;
    igw.name = first ? 'igw-1' : `igw-${v.name ?? v.id}`;
    board.components[igw.id] = igw;
    vpc.attachments.push(igw.id);
  }
}

function allVpcsOf(board: Board): Vpc[] {
  return board.regions.flatMap((r) => r.vpcs);
}

/** Region a component lives in ('global' for edge services, 'onprem' for the data centre). */
export function regionOf(board: Board, c: Component): string {
  if (c.placement.kind === 'edge') return 'global';
  if (c.placement.kind === 'onprem') return 'onprem';
  if (c.placement.kind === 'region') return c.placement.refId;
  const vpc = vpcOfComponent(board, c);
  return board.regions.find((r) => r.vpcs.some((v) => v.id === vpc?.id))?.id ?? board.regions[0]?.id ?? 'us-east-1';
}

export function regionOfVpc(board: Board, vpcId: string): string | undefined {
  return board.regions.find((r) => r.vpcs.some((v) => v.id === vpcId))?.id;
}

export function vpcById(board: Board, vpcId: string): Vpc | undefined {
  return allVpcsOf(board).find((v) => v.id === vpcId);
}

/** The account that owns a VPC or component (Stage 3 accounts layer). */
export function accountOf(board: Board, x: { accountId?: string }): string {
  return x.accountId ?? board.iam?.accountId ?? '111122223333';
}

// ---------- Catalog defaults ----------

export const DEFAULT_NAMES: Record<ServiceType, string> = {
  alb: 'web-alb',
  ec2: 'instance',
  asg: 'app-asg',
  rds: 'app-db',
  s3: 'bucket',
  sqs: 'queue',
  lambda: 'function',
  apigw: 'api',
  dynamodb: 'table',
  cloudfront: 'cdn',
  route53: 'dns',
  waf: 'web-acl',
  nat: 'nat',
  igw: 'igw',
  vpce: 's3-endpoint',
  aurora: 'aurora-cluster',
  pcx: 'pcx',
  tgw: 'tgw',
  vgw: 'vgw',
  cgw: 'cgw',
  vpn: 'vpn',
  dx: 'dx',
  backup: 'backup-plan',
  kinesis: 'stream',
  firehose: 'delivery',
  athena: 'athena',
  snow: 'snowball',
  datasync: 'datasync',
  dms: 'dms-task',
};

export function defaultConfig(type: ServiceType): ServiceConfig {
  switch (type) {
    case 'alb':
      return {
        type,
        scheme: 'internet-facing',
        listener: { port: 443, protocol: 'HTTPS' },
        targetId: null,
        targetPort: 443,
        healthCheck: { path: '/health', intervalSec: 30, timeoutSec: 5, healthyThreshold: 5, unhealthyThreshold: 2 },
        crossZone: true,
      };
    case 'ec2':
      return { type, instanceType: 't3.medium', publicIp: false, app: { port: 443, healthPath: '/health' } };
    case 'asg':
      return {
        type,
        instanceType: 't3.medium',
        publicIp: false,
        min: 2,
        max: 4,
        desired: 2,
        policy: { kind: 'targetTracking', targetCpu: 50 },
        warmupSec: 300,
        healthCheckType: 'EC2',
        healthCheckGraceSec: 300,
        app: { port: 443, healthPath: '/health' },
      };
    case 'rds':
      return {
        type,
        engine: 'mysql',
        port: 3306,
        instanceClass: 'db.t3.medium',
        multiAz: false,
        backupRetentionDays: 7,
        readReplicas: 0,
        publiclyAccessible: false,
        storageEncrypted: false,
        allocatedStorageGb: 100,
      };
    case 's3':
      return { type, blockPublicAccess: true, versioning: false, encryption: 'SSE-S3', policy: 'none', policyDistributionId: null, staticWebsite: false };
    case 'sqs':
      return { type, fifo: false, visibilityTimeoutSec: 30, retentionSec: 345600, dlqId: null, maxReceiveCount: 5, sse: true };
    case 'lambda':
      return { type, memoryMb: 512, timeoutSec: 3, reservedConcurrency: null, eventSourceId: null, coldStartMs: 400 };
    case 'apigw':
      return { type, integration: { kind: 'lambda', targetId: null }, throttleRps: 10000, burst: 5000 };
    case 'dynamodb':
      return { type, billingMode: 'onDemand', wcu: 5, rcu: 5, pitr: false };
    case 'cloudfront':
      return { type, originId: null, oac: false, viewerProtocol: 'redirect-to-https', cacheHitRatio: 0.9 };
    case 'route53':
      return { type, recordName: 'www', aliasTargetId: null };
    case 'waf':
      return { type, associatedId: null, managedRules: true, rateLimitPer5Min: 2000 };
    case 'nat':
      return { type };
    case 'igw':
      return { type };
    case 'vpce':
      return { type, service: 's3', routeTableIds: [] };
    case 'aurora':
      return {
        type,
        engine: 'aurora-mysql',
        port: 3306,
        instanceClass: 'db.r6g.large',
        readers: 0,
        serverlessV2: false,
        minAcu: 0.5,
        maxAcu: 16,
        backupRetentionDays: 7,
        storageEncrypted: true,
        publiclyAccessible: false,
        globalPrimaryId: null,
      };
    case 'pcx':
      return { type, peerVpcId: null };
    case 'tgw':
      return { type, vpcAttachments: [], routeTables: [{ id: 'tgw-rtb-default', name: 'default', associations: [], propagations: [], routes: [] }], ramShared: false };
    case 'vgw':
      return { type };
    case 'cgw':
      return { type, bgpAsn: 65000 };
    case 'vpn':
      return { type, cgwId: null, attachTo: null };
    case 'dx':
      return { type, speedGbps: 1, attachTo: null, encryption: 'none' };
    case 'backup':
      return { type, resourceIds: [], frequencyHours: 24, retentionDays: 35, copyRegion: null, copyToOtherAccount: false, vaultLock: 'none' };
    case 'kinesis':
      return { type, mode: 'provisioned', shards: 1, retentionHours: 24 };
    case 'firehose':
      return { type, sourceId: null, destId: null, bufferSec: 300, bufferMb: 5, format: 'json' };
    case 'athena':
      return { type, sourceId: null };
    case 'snow':
      return { type, devices: 1, destId: null };
    case 'datasync':
      return { type, destId: null, schedule: 'once' };
    case 'dms':
      return { type, targetId: null, mode: 'full-load' };
  }
}

export const ZONE_FOR: Record<ServiceType, Placement['kind']> = {
  cloudfront: 'edge',
  route53: 'edge',
  waf: 'edge',
  s3: 'region',
  sqs: 'region',
  lambda: 'region',
  apigw: 'region',
  dynamodb: 'region',
  igw: 'vpcAttach',
  vpce: 'vpcAttach',
  alb: 'subnet',
  ec2: 'subnet',
  asg: 'subnet',
  rds: 'subnet',
  nat: 'subnet',
  aurora: 'subnet',
  pcx: 'vpcAttach',
  vgw: 'vpcAttach',
  tgw: 'region',
  backup: 'region',
  kinesis: 'region',
  firehose: 'region',
  athena: 'region',
  dms: 'region',
  cgw: 'onprem',
  vpn: 'onprem',
  dx: 'onprem',
  snow: 'onprem',
  datasync: 'onprem',
};

export const MULTI_SUBNET: ServiceType[] = ['alb', 'asg', 'rds', 'aurora'];
export const HAS_ENI: ServiceType[] = ['alb', 'ec2', 'asg', 'rds', 'aurora'];
export const DATABASES: ServiceType[] = ['rds', 'aurora'];

function nextId(board: Board, prefix: string): string {
  board.seq += 1;
  return `${prefix}-${board.seq}`;
}

function uniqueName(board: Board, base: string): string {
  const names = new Set(Object.values(board.components).map((c) => c.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base}-${i}`)) return `${base}-${i}`;
}

function makeComponent(board: Board, type: ServiceType, placement: Placement): Component {
  return { id: nextId(board, type), type, name: DEFAULT_NAMES[type], placement, config: defaultConfig(type) };
}

export function vpcOfComponent(board: Board, c: Component): Vpc | null {
  if (c.placement.kind === 'vpcAttach') return board.regions.flatMap((r) => r.vpcs).find((v) => v.id === c.placement.refId) ?? null;
  if (c.placement.kind === 'subnet') return findSubnet(board, c.placement.refId)?.vpc ?? null;
  return null;
}

export function subnetsOf(c: Component): string[] {
  if (c.placement.kind !== 'subnet') return [];
  return c.subnets && c.subnets.length ? c.subnets : [c.placement.refId];
}

export function componentsOfType<T extends ServiceType>(board: Board, type: T): (Component & { config: ConfigOf<T> })[] {
  return Object.values(board.components).filter((c) => c.type === type) as (Component & { config: ConfigOf<T> })[];
}

/** Deterministic private IP for a component's ENI in a subnet. */
export function eniIp(board: Board, c: Component, subnetId: string): string {
  const s = findSubnet(board, subnetId);
  if (!s) return '0.0.0.0';
  const n = Number(c.id.split('-').pop()) || 1;
  return hostIp(s.subnet.cidr, n * 7);
}

// ---------- Placement ----------

export function validatePlacement(board: Board, type: ServiceType, zone: Placement): string | null {
  const need = ZONE_FOR[type];
  if (zone.kind !== need) {
    const where: Record<string, string> = {
      edge: 'the global edge zone (it is a global service)',
      region: 'the Region (it is a regional, managed service that does not live in a subnet)',
      vpcAttach: 'the VPC attachment strip (it attaches to the VPC, not to a subnet)',
      subnet: 'a subnet (it gets network interfaces inside your VPC)',
      onprem: 'the on-premises data centre',
    };
    return `${labelOf(type)} must be placed in ${where[need]}.`;
  }
  if (zone.kind === 'onprem' && !board.onprem) return 'This mission has no on-premises data centre.';
  if (zone.kind === 'region' && !board.regions.some((r) => r.id === zone.refId)) return 'Unknown Region.';
  if (type === 'vgw') {
    const existing = componentsOfType(board, 'vgw').find((c) => c.placement.refId === zone.refId);
    if (existing) return `This VPC already has ${existing.name} attached. A VPC can have only one virtual private gateway.`;
  }
  if (zone.kind === 'subnet' && !findSubnet(board, zone.refId)) return 'Unknown subnet.';
  if (type === 'nat' && zone.kind === 'subnet' && !isPublicSubnet(board, zone.refId)) {
    return 'A public NAT gateway must be placed in a public subnet: one whose route table sends 0.0.0.0/0 to an internet gateway. It needs that route to reach the internet on behalf of private subnets.';
  }
  if (type === 'igw') {
    const existing = componentsOfType(board, 'igw').find((c) => c.placement.refId === zone.refId);
    if (existing) return `This VPC already has ${existing.name} attached. A VPC can have only one internet gateway.`;
  }
  return null;
}

export function labelOf(type: ServiceType): string {
  const m: Record<ServiceType, string> = {
    alb: 'An Application Load Balancer',
    ec2: 'An EC2 instance',
    asg: 'An Auto Scaling group',
    rds: 'An RDS database',
    s3: 'An S3 bucket',
    sqs: 'An SQS queue',
    lambda: 'A Lambda function',
    apigw: 'An API Gateway API',
    dynamodb: 'A DynamoDB table',
    cloudfront: 'A CloudFront distribution',
    route53: 'A Route 53 record',
    waf: 'An AWS WAF web ACL',
    nat: 'A NAT gateway',
    igw: 'An internet gateway',
    vpce: 'A gateway endpoint',
    aurora: 'An Aurora cluster',
    pcx: 'A VPC peering connection',
    tgw: 'A transit gateway',
    vgw: 'A virtual private gateway',
    cgw: 'A customer gateway',
    vpn: 'A Site-to-Site VPN connection',
    dx: 'A Direct Connect connection',
    backup: 'An AWS Backup plan',
    kinesis: 'A Kinesis data stream',
    firehose: 'A Firehose stream',
    athena: 'An Athena workgroup',
    snow: 'A Snowball job',
    datasync: 'A DataSync task',
    dms: 'A DMS migration task',
  };
  return m[type];
}

export interface PlaceOptions {
  name?: string;
  subnets?: string[];
  config?: Partial<ServiceConfig>;
}

export type OpResult = { ok: true; board: Board; id?: string } | { ok: false; error: string };

export function placeComponent(board0: Board, type: ServiceType, zone: Placement, defaults: Defaults, opts: PlaceOptions = {}): OpResult {
  const err = validatePlacement(board0, type, zone);
  if (err) return { ok: false, error: err };
  const board = clone(board0);
  const c = makeComponent(board, type, zone);
  c.name = uniqueName(board, opts.name ?? defaultNameFor(board, type, zone));
  if (opts.config) c.config = { ...c.config, ...opts.config } as ServiceConfig;

  if (zone.kind === 'subnet') {
    const home = findSubnet(board, zone.refId)!;
    if (MULTI_SUBNET.includes(type)) {
      c.subnets = opts.subnets ?? home.vpc.azs.flatMap((a) => a.subnets.filter((s) => s.tier === home.subnet.tier).map((s) => s.id));
      if (!c.subnets.includes(zone.refId)) c.subnets.unshift(zone.refId);
    }
    for (const sid of subnetsOf(c)) findSubnet(board, sid)!.subnet.components.push(c.id);
  } else if (zone.kind === 'edge') board.edge.push(c.id);
  else if (zone.kind === 'region') (board.regions.find((r) => r.id === zone.refId) ?? board.regions[0]).regionalServices.push(c.id);
  else if (zone.kind === 'vpcAttach') board.regions.flatMap((r) => r.vpcs).find((v) => v.id === zone.refId)?.attachments.push(c.id);
  else if (zone.kind === 'onprem') board.onprem!.components.push(c.id);
  if (c.placement.kind === 'region') c.placement.refId = (board.regions.find((r) => r.id === zone.refId) ?? board.regions[0]).id;

  board.components[c.id] = c;

  if (HAS_ENI.includes(type)) {
    const vpc = vpcOfComponent(board, c)!;
    const sg = createSgFor(board, c, vpc.id, defaults);
    c.securityGroupIds = [sg.id];
  }

  if (defaults === 'helpful' && type === 'nat') prewireNat(board, c);
  autoWire(board, c);

  if (MULTI_SUBNET.includes(type)) {
    const e = validateSubnets(board, c, subnetsOf(c));
    if (e) return { ok: false, error: e };
  }
  return { ok: true, board, id: c.id };
}

function defaultNameFor(board: Board, type: ServiceType, zone: Placement): string {
  if (type === 'nat' && zone.kind === 'subnet') {
    const s = findSubnet(board, zone.refId);
    const az = s?.subnet.azId.slice(-1) ?? '';
    return `nat-${az}`;
  }
  return DEFAULT_NAMES[type];
}

function createSgFor(board: Board, c: Component, vpcId: string, defaults: Defaults): SecurityGroup {
  const base: Record<string, string> = { alb: 'alb-sg', asg: 'app-sg', ec2: 'instance-sg', rds: 'db-sg', aurora: 'db-sg' };
  const names = new Set(Object.values(board.securityGroups).map((s) => s.name));
  let name = base[c.type] ?? `${c.name}-sg`;
  for (let i = 2; names.has(name); i++) name = `${base[c.type]}-${i}`;
  const sg: SecurityGroup = {
    id: nextId(board, 'sg'),
    name,
    vpcId,
    inbound: [],
    outbound: [{ protocol: 'all', fromPort: 0, toPort: 65535, source: { cidr: '0.0.0.0/0' }, description: 'Default: all outbound' }],
  };
  if (defaults === 'helpful') {
    // The SG of the first component of a type in the same VPC (SG names get suffixes in later VPCs).
    const find = (types: ServiceType[]) => {
      const owner = Object.values(board.components).find((o) => types.includes(o.type) && o.securityGroupIds?.length && vpcOfComponent(board, o)?.id === vpcId);
      return owner ? board.securityGroups[owner.securityGroupIds![0]] : undefined;
    };
    if (c.type === 'alb') sg.inbound.push({ protocol: 'tcp', fromPort: 443, toPort: 443, source: { cidr: '0.0.0.0/0' }, description: 'HTTPS from anywhere' });
    if (c.type === 'asg' || c.type === 'ec2') {
      const alb = find(['alb']);
      if (alb) sg.inbound.push({ protocol: 'tcp', fromPort: 443, toPort: 443, source: { sg: alb.id }, description: 'HTTPS from the load balancer' });
    }
    if (c.type === 'rds' || c.type === 'aurora') {
      const app = find(['asg']);
      const port = (c.config as ConfigOf<'rds'> | ConfigOf<'aurora'>).port;
      if (app) sg.inbound.push({ protocol: 'tcp', fromPort: port, toPort: port, source: { sg: app.id }, description: 'Database from the app tier' });
    }
  }
  board.securityGroups[sg.id] = sg;
  return sg;
}

/** Helpful mode: a new NAT becomes the default route for private route tables in its AZ that have none. */
function prewireNat(board: Board, nat: Component) {
  const home = findSubnet(board, nat.placement.refId);
  if (!home) return;
  for (const rt of Object.values(board.routeTables)) {
    if (rt.vpcId !== home.vpc.id || rt.routes.some((r) => r.dest === '0.0.0.0/0')) continue;
    const assoc = allSubnets(board).filter((s) => s.routeTableId === rt.id);
    if (assoc.length && assoc.every((s) => s.azId === home.subnet.azId)) rt.routes.push({ dest: '0.0.0.0/0', target: { nat: nat.id } });
  }
}

/** Fill empty references when there is exactly one sensible candidate. */
function autoWire(board: Board, placed: Component) {
  const comps = Object.values(board.components);
  const only = (types: ServiceType[], except?: string) => {
    const xs = comps.filter((c) => types.includes(c.type) && c.id !== except);
    return xs.length === 1 ? xs[0].id : null;
  };
  for (const c of comps) {
    const cfg = c.config;
    if (cfg.type === 'alb' && !cfg.targetId) cfg.targetId = only(['asg', 'ec2']);
    if (cfg.type === 'cloudfront' && !cfg.originId) cfg.originId = only(['s3']) ?? only(['alb']);
    if (cfg.type === 'route53' && !cfg.aliasTargetId) cfg.aliasTargetId = only(['cloudfront']) ?? only(['alb']);
    if (cfg.type === 'waf' && !cfg.associatedId) cfg.associatedId = only(['cloudfront']) ?? only(['alb']);
    if (cfg.type === 'apigw' && !cfg.integration.targetId) cfg.integration.targetId = only([cfg.integration.kind]);
    if (cfg.type === 'lambda' && !cfg.eventSourceId && placed.type === 'sqs') cfg.eventSourceId = only(['sqs']);
    if (cfg.type === 's3' && cfg.policy === 'cloudfront-oac' && !cfg.policyDistributionId) cfg.policyDistributionId = only(['cloudfront']);
    if (cfg.type === 'lambda' && !cfg.eventSourceId && placed.type === 'kinesis') cfg.eventSourceId = only(['kinesis']);
    if (cfg.type === 'vpn' && !cfg.cgwId) cfg.cgwId = only(['cgw']);
    if ((cfg.type === 'vpn' || cfg.type === 'dx') && !cfg.attachTo) cfg.attachTo = only(['vgw', 'tgw']);
    if (cfg.type === 'firehose' && !cfg.destId) cfg.destId = only(['s3']);
    if (cfg.type === 'firehose' && !cfg.sourceId && placed.type === 'kinesis') cfg.sourceId = only(['kinesis']);
    if (cfg.type === 'athena' && !cfg.sourceId) cfg.sourceId = only(['s3']);
    if ((cfg.type === 'snow' || cfg.type === 'datasync') && !cfg.destId) cfg.destId = only(['s3']);
    if (cfg.type === 'dms' && !cfg.targetId) cfg.targetId = only(['rds', 'aurora']);
  }
}

/** Config fields that hold a component id (cleared when that component is deleted, resolved by name in the builder). */
export const REF_FIELDS = ['targetId', 'originId', 'aliasTargetId', 'associatedId', 'eventSourceId', 'dlqId', 'policyDistributionId', 'replicaOf', 'globalPrimaryId', 'cgwId', 'attachTo', 'sourceId', 'destId'];

export function removeComponent(board0: Board, id: ComponentId): OpResult {
  const c = board0.components[id];
  if (!c) return { ok: false, error: 'Unknown component.' };
  if (c.locked) return { ok: false, error: `${c.name} is locked in this mission.` };
  const board = clone(board0);
  delete board.components[id];
  board.edge = board.edge.filter((x) => x !== id);
  for (const r of board.regions) {
    r.regionalServices = r.regionalServices.filter((x) => x !== id);
    for (const v of r.vpcs) {
      v.attachments = v.attachments.filter((x) => x !== id);
      for (const az of v.azs) for (const s of az.subnets) s.components = s.components.filter((x) => x !== id);
    }
  }
  // Security groups owned only by this component go with it (AWS would leave them, but the board stays tidy).
  for (const sgId of c.securityGroupIds ?? []) {
    const stillUsed = Object.values(board.components).some((o) => o.securityGroupIds?.includes(sgId));
    if (!stillUsed) {
      delete board.securityGroups[sgId];
      for (const sg of Object.values(board.securityGroups)) {
        sg.inbound = sg.inbound.filter((r) => !('sg' in r.source && r.source.sg === sgId));
        sg.outbound = sg.outbound.filter((r) => !('sg' in r.source && r.source.sg === sgId));
      }
    }
  }
  board.onprem && (board.onprem.components = board.onprem.components.filter((x) => x !== id));
  // Routes to a deleted NAT, IGW, peering connection or gateway stay behind as blackholes, exactly like AWS.
  for (const o of Object.values(board.components)) {
    const cfg = o.config as any;
    for (const k of REF_FIELDS) if (cfg[k] === id) cfg[k] = null;
    if (cfg.integration?.targetId === id) cfg.integration.targetId = null;
    if (cfg.records) for (const r of cfg.records) if (r.targetId === id) r.targetId = null;
    if (cfg.resourceIds) cfg.resourceIds = cfg.resourceIds.filter((x: string) => x !== id);
    if (cfg.replication?.destId === id) cfg.replication = { ...cfg.replication, destId: null };
    if (cfg.routeTables && o.type === 'tgw')
      for (const rt of cfg.routeTables) {
        rt.associations = rt.associations.filter((x: string) => x !== id);
        rt.propagations = rt.propagations.filter((x: string) => x !== id);
      }
  }
  return { ok: true, board };
}

// ---------- Config edits ----------

export function validateSubnets(board: Board, c: Component, subnets: string[]): string | null {
  const found = subnets.map((s) => findSubnet(board, s));
  if (found.some((f) => !f)) return 'Unknown subnet.';
  const azs = new Set(found.map((f) => f!.subnet.azId));
  if (c.type === 'alb') {
    if (azs.size < 2) return 'At least two subnets in two different Availability Zones must be specified.';
    if (azs.size !== subnets.length) return 'A load balancer can be enabled in only one subnet per Availability Zone.';
  }
  if ((c.type === 'rds' || c.type === 'aurora') && azs.size < 2)
    return "DB Subnet Group doesn't meet Availability Zone (AZ) coverage requirement. Current AZ coverage: " +
      [...azs].join(', ') + '. Add subnets to cover at least 2 AZs.';
  if (subnets.length === 0) return 'Select at least one subnet.';
  return null;
}

export function setSubnets(board0: Board, id: ComponentId, subnets: string[]): OpResult {
  const c0 = board0.components[id];
  if (!c0) return { ok: false, error: 'Unknown component.' };
  const err = validateSubnets(board0, c0, subnets);
  if (err) return { ok: false, error: err };
  const board = clone(board0);
  const c = board.components[id];
  for (const s of allSubnets(board)) s.components = s.components.filter((x) => x !== id);
  c.subnets = [...subnets];
  c.placement = { kind: 'subnet', refId: subnets[0] };
  for (const sid of subnets) findSubnet(board, sid)!.subnet.components.push(id);
  return { ok: true, board };
}

export function validateConfig(board: Board, c: Component, cfg: ServiceConfig): string | null {
  if (cfg.type === 's3') {
    if (cfg.policy === 'public-read' && cfg.blockPublicAccess)
      return 'Access denied: Block Public Access (BlockPublicPolicy) is on, so S3 rejects a bucket policy that grants public access. Turn off Block Public Access first, if you really mean to make the bucket public.';
    if (cfg.staticWebsite && cfg.blockPublicAccess && cfg.policy === 'none') return null;
  }
  if (cfg.type === 'rds') {
    if (cfg.backupRetentionDays < 0 || cfg.backupRetentionDays > 35) return 'Backup retention must be between 0 and 35 days.';
    if (cfg.readReplicas > 0 && cfg.backupRetentionDays === 0) return 'Automatic backups must be enabled (retention ≥ 1 day) before you can create a read replica.';
    if (cfg.readReplicas < 0 || cfg.readReplicas > 15) return 'An RDS instance can have between 0 and 15 read replicas.';
  }
  if (cfg.type === 'asg') {
    if (cfg.min < 0 || cfg.max < cfg.min) return 'Maximum capacity must be greater than or equal to minimum capacity.';
    if (cfg.desired < cfg.min || cfg.desired > cfg.max) return 'Desired capacity must be between the minimum and maximum capacity.';
  }
  if (cfg.type === 'sqs') {
    if (cfg.visibilityTimeoutSec < 0 || cfg.visibilityTimeoutSec > 43200) return 'Visibility timeout must be between 0 seconds and 12 hours (43,200 seconds).';
    if (cfg.retentionSec < 60 || cfg.retentionSec > 1209600) return 'Message retention must be between 60 seconds and 14 days.';
    if (cfg.dlqId) {
      const dlq = board.components[cfg.dlqId];
      if (!dlq || dlq.config.type !== 'sqs') return 'The dead-letter queue must be another SQS queue.';
      if (dlq.id === c.id) return 'A queue cannot be its own dead-letter queue.';
      if (dlq.config.fifo !== cfg.fifo) return 'The dead-letter queue of a FIFO queue must also be a FIFO queue (and Standard needs Standard).';
    }
    if (cfg.maxReceiveCount < 1 || cfg.maxReceiveCount > 1000) return 'maxReceiveCount must be between 1 and 1,000.';
  }
  if (cfg.type === 'lambda') {
    if (cfg.timeoutSec < 1 || cfg.timeoutSec > 900) return 'Lambda timeout must be between 1 and 900 seconds (15 minutes).';
    if (cfg.reservedConcurrency !== null && (cfg.reservedConcurrency < 0 || cfg.reservedConcurrency > 900))
      return 'Reserved concurrency can be at most 900: the account limit is 1,000 and Lambda keeps 100 unreserved.';
  }
  if (cfg.type === 'alb') {
    const hc = cfg.healthCheck;
    if (hc.intervalSec < 5 || hc.intervalSec > 300) return 'Health check interval must be between 5 and 300 seconds.';
    if (hc.timeoutSec >= hc.intervalSec) return 'Health check timeout must be smaller than the interval.';
    if (hc.unhealthyThreshold < 2 || hc.unhealthyThreshold > 10 || hc.healthyThreshold < 2 || hc.healthyThreshold > 10) return 'Thresholds must be between 2 and 10.';
  }
  if (cfg.type === 'vpce') {
    const vpc = vpcOfComponent(board, c);
    for (const rtId of cfg.routeTableIds) if (!board.routeTables[rtId] || board.routeTables[rtId].vpcId !== vpc?.id) return 'A gateway endpoint can only be associated with route tables in its own VPC.';
  }
  return validateStage3Config(board, c, cfg);
}

const S3_CLASS_ORDER: Record<string, number> = { STANDARD: 0, INTELLIGENT_TIERING: 1, STANDARD_IA: 2, ONEZONE_IA: 3, GLACIER_IR: 4, GLACIER: 5, DEEP_ARCHIVE: 6 };

function validateStage3Config(board: Board, c: Component, cfg: ServiceConfig): string | null {
  const comp = (id: string | null | undefined) => (id ? board.components[id] : undefined);
  if (cfg.type === 'rds' && cfg.replicaOf) {
    const src = comp(cfg.replicaOf);
    if (!src || src.config.type !== 'rds') return 'A read replica source must be another RDS DB instance.';
    if (src.id === c.id) return 'An instance cannot replicate from itself.';
    if (src.config.backupRetentionDays === 0) return 'Automatic backups must be enabled on the source instance (retention ≥ 1 day) before you can create a read replica.';
    if (src.config.engine !== cfg.engine) return 'A read replica uses the same engine as its source.';
  }
  if (cfg.type === 'aurora') {
    if (cfg.backupRetentionDays < 1 || cfg.backupRetentionDays > 35) return 'Aurora backup retention must be between 1 and 35 days (Aurora backups cannot be turned off).';
    if (cfg.readers < 0 || cfg.readers > 15) return 'An Aurora cluster can have up to 15 Aurora Replicas.';
    if (cfg.serverlessV2 && (cfg.minAcu < 0 || cfg.maxAcu < cfg.minAcu || cfg.maxAcu > 256)) return 'Serverless v2 capacity: minimum ≥ 0 ACU, maximum ≥ minimum and ≤ 256 ACU.';
    if (cfg.globalPrimaryId) {
      const p = comp(cfg.globalPrimaryId);
      if (!p || p.config.type !== 'aurora' || p.id === c.id) return 'The primary of an Aurora Global Database must be another Aurora cluster.';
      if (regionOf(board, p) === regionOf(board, c)) return 'Each secondary cluster of an Aurora Global Database must be in a different Region from the primary.';
      if (p.config.engine !== cfg.engine) return 'A global database secondary uses the same engine as its primary.';
    }
  }
  if (cfg.type === 'dynamodb') {
    const home = regionOf(board, c);
    for (const r of cfg.replicaRegions ?? []) {
      if (!board.regions.some((x) => x.id === r)) return `Region ${r} is not on the board.`;
      if (r === home) return 'A global table replica must be in a different Region from the table.';
    }
  }
  if (cfg.type === 's3') {
    const lc = cfg.lifecycle ?? [];
    let prev = { days: 0, rank: S3_CLASS_ORDER[cfg.storageClass ?? 'STANDARD'] };
    for (const t of [...lc].sort((a, b) => a.afterDays - b.afterDays)) {
      if (t.afterDays < 0) return 'Transition days must be zero or more.';
      if ((t.toClass === 'STANDARD_IA' || t.toClass === 'ONEZONE_IA') && t.afterDays < 30)
        return `'Days' in Transition action must be greater than or equal to 30 for storageClass '${t.toClass}'. Objects must stay at least 30 days in S3 Standard before moving to an IA class.`;
      if (t.toClass === 'STANDARD' || S3_CLASS_ORDER[t.toClass] <= prev.rank) return `Lifecycle transitions only go "down the waterfall" (Standard → IA → Glacier → Deep Archive). ${t.toClass} can't follow the previous class.`;
      if (t.afterDays <= prev.days && prev.days > 0) return 'Each transition must happen later than the previous one.';
      prev = { days: t.afterDays, rank: S3_CLASS_ORDER[t.toClass] };
    }
    if (cfg.expireAfterDays != null) {
      if (cfg.expireAfterDays < 1) return 'Expiration days must be a positive integer.';
      if (lc.some((t) => t.afterDays >= cfg.expireAfterDays!)) return 'Objects must expire after their last transition.';
    }
    const lock = cfg.objectLock?.mode ?? 'none';
    if (lock !== 'none' && !cfg.versioning) return 'Object Lock requires versioning, and once Object Lock is enabled versioning cannot be suspended.';
    if (lock !== 'none' && (cfg.objectLock!.retentionDays < 1 || cfg.objectLock!.retentionDays > 36500)) return 'Default retention must be between 1 day and 100 years.';
    if (cfg.mfaDelete && !cfg.versioning) return 'MFA Delete is a versioning setting: enable versioning first.';
    const dest = comp(cfg.replication?.destId);
    if (cfg.replication?.destId) {
      if (!dest || dest.config.type !== 's3') return 'The replication destination must be another S3 bucket.';
      if (dest.id === c.id) return 'A bucket cannot replicate to itself.';
      if (!cfg.versioning || !dest.config.versioning) return 'Replication requires versioning on both the source and the destination bucket.';
    }
    const prevCfg = c.config.type === 's3' ? c.config : null;
    if (prevCfg && prevCfg.versioning && !cfg.versioning && (prevCfg.objectLock?.mode ?? 'none') !== 'none') return 'Versioning cannot be suspended on a bucket with Object Lock enabled.';
    // A destination bucket can't lose versioning while something replicates into it.
    if (!cfg.versioning && Object.values(board.components).some((o) => o.config.type === 's3' && o.config.replication?.destId === c.id)) return 'This bucket is a replication destination: versioning must stay enabled.';
  }
  if (cfg.type === 'pcx') {
    const own = vpcOfComponent(board, c);
    if (cfg.peerVpcId) {
      const peer = vpcById(board, cfg.peerVpcId);
      if (!peer) return 'Unknown peer VPC.';
      if (own && peer.id === own.id) return 'A VPC cannot be peered with itself.';
      if (own && cidrsOverlap(own.cidr, peer.cidr)) return `VPC peering connection failed: the CIDR blocks overlap (${own.cidr} and ${peer.cidr}). You cannot peer VPCs with overlapping IPv4 CIDR blocks.`;
      const dup = componentsOfType(board, 'pcx').find((o) => o.id !== c.id && own && pcxConnects(board, o, own.id, peer.id));
      if (dup) return `${dup.name} already peers these two VPCs. Only one peering connection can exist between a pair of VPCs.`;
    }
  }
  if (cfg.type === 'tgw') {
    const home = regionOf(board, c);
    const seen = new Set<string>();
    for (const vid of cfg.vpcAttachments) {
      const v = vpcById(board, vid);
      if (!v) return `Unknown VPC ${vid}.`;
      if (regionOfVpc(board, vid) !== home) return `${v.name ?? v.id} is in another Region. A transit gateway attaches VPCs in its own Region (use TGW peering between Regions).`;
      if (accountOf(board, v) !== accountOf(board, c) && !cfg.ramShared) return `${v.name ?? v.id} belongs to account ${accountOf(board, v)}. Share the transit gateway with that account through AWS RAM before attaching its VPC.`;
    }
    for (const rt of cfg.routeTables) {
      for (const a of rt.associations) {
        if (seen.has(a)) return `An attachment can be associated with only one transit gateway route table (${a}).`;
        seen.add(a);
      }
      for (const r of rt.routes) if (!isValidCidr(r.dest) || !isCanonicalCidr(r.dest)) return `"${r.dest}" is not a valid destination CIDR block.`;
    }
  }
  if (cfg.type === 'vpn') {
    if (cfg.cgwId && comp(cfg.cgwId)?.type !== 'cgw') return 'A VPN connection terminates on a customer gateway.';
    if (cfg.attachTo && !['vgw', 'tgw'].includes(comp(cfg.attachTo)?.type ?? '')) return 'A Site-to-Site VPN attaches to a virtual private gateway or a transit gateway.';
  }
  if (cfg.type === 'dx') {
    if (cfg.attachTo && !['vgw', 'tgw'].includes(comp(cfg.attachTo)?.type ?? '')) return 'A Direct Connect connection reaches a VPC through a virtual private gateway, or a transit gateway (via a Direct Connect gateway).';
    if (cfg.encryption === 'macsec' && cfg.speedGbps < 10) return 'MACsec is supported on 10 Gbps and 100 Gbps (and faster) dedicated connections only.';
  }
  if (cfg.type === 'backup') {
    if (cfg.frequencyHours < 1) return 'Backup frequency must be at least once an hour.';
    if (cfg.retentionDays < 1) return 'Retention must be at least 1 day.';
    if (cfg.copyRegion && !board.regions.some((r) => r.id === cfg.copyRegion)) return `Region ${cfg.copyRegion} is not on the board.`;
    if (cfg.copyRegion && cfg.copyRegion === regionOf(board, c)) return 'A cross-Region copy needs a different Region.';
  }
  if (cfg.type === 'kinesis') {
    if (cfg.mode === 'provisioned' && (cfg.shards < 1 || cfg.shards > 500)) return 'A provisioned stream needs between 1 and 500 shards (default shard quota).';
    if (cfg.retentionHours < 24 || cfg.retentionHours > 8760) return 'Retention must be between 24 hours and 365 days (8,760 hours).';
  }
  if (cfg.type === 'firehose') {
    if (cfg.bufferSec < 0 || cfg.bufferSec > 900) return 'Buffer interval must be between 0 and 900 seconds.';
    if (cfg.bufferMb < 1 || cfg.bufferMb > 128) return 'Buffer size must be between 1 and 128 MiB.';
    if (cfg.format === 'parquet' && cfg.bufferMb < 64) return 'Record format conversion requires a buffer size of at least 64 MiB.';
    if (cfg.sourceId && comp(cfg.sourceId)?.type !== 'kinesis') return 'The source must be a Kinesis data stream (or none, for Direct PUT).';
  }
  if (cfg.type === 'snow' && (cfg.devices < 1 || cfg.devices > 20)) return 'Order between 1 and 20 devices per job.';
  return null;
}

/** Does this peering connection join the two VPCs (in either direction)? */
export function pcxConnects(_board: Board, pcx: Component, a: string, b: string): boolean {
  if (pcx.config.type !== 'pcx' || !pcx.config.peerVpcId) return false;
  const req = pcx.placement.refId;
  const acc = pcx.config.peerVpcId;
  return (req === a && acc === b) || (req === b && acc === a);
}

export function updateConfig(board0: Board, id: ComponentId, patch: Partial<ServiceConfig>): OpResult {
  const c0 = board0.components[id];
  if (!c0) return { ok: false, error: 'Unknown component.' };
  const cfg = { ...c0.config, ...patch } as ServiceConfig;
  const err = validateConfig(board0, c0, cfg);
  if (err) return { ok: false, error: err };
  const board = clone(board0);
  board.components[id].config = cfg;
  return { ok: true, board };
}

export function renameComponent(board0: Board, id: ComponentId, name: string): OpResult {
  if (!/^[a-zA-Z0-9-]{1,40}$/.test(name)) return { ok: false, error: 'Names may contain letters, numbers and hyphens (max 40).' };
  const board = clone(board0);
  if (!board.components[id]) return { ok: false, error: 'Unknown component.' };
  board.components[id].name = name;
  return { ok: true, board };
}

// ---------- Security groups ----------

export interface SgRuleInput extends SgRule {
  action?: 'allow' | 'deny';
}

export function validateSgRule(board: Board, sg: SecurityGroup, rule: SgRuleInput): string | null {
  if (rule.action === 'deny') return 'Security groups only support allow rules. To block traffic, use a network ACL.';
  if (rule.protocol !== 'all' && rule.protocol !== 'icmp') {
    if (rule.fromPort < 0 || rule.toPort > 65535 || rule.fromPort > rule.toPort) return 'Port range must be within 0-65535 and from ≤ to.';
  }
  if ('cidr' in rule.source && !isValidCidr(rule.source.cidr)) return `"${rule.source.cidr}" is not a valid CIDR block.`;
  if ('sg' in rule.source) {
    const ref = board.securityGroups[rule.source.sg];
    if (!ref) return `Security group ${rule.source.sg} does not exist.`;
    if (ref.vpcId !== sg.vpcId) {
      const peered = componentsOfType(board, 'pcx').some((p) => pcxConnects(board, p, ref.vpcId, sg.vpcId));
      const sameRegion = regionOfVpc(board, ref.vpcId) === regionOfVpc(board, sg.vpcId);
      if (!peered) return `You can't reference ${ref.name}: it belongs to a different VPC and the VPCs are not peered.`;
      if (!sameRegion) return `You can't reference ${ref.name}: security group references don't work across an inter-Region peering connection. Use the peer VPC's CIDR instead.`;
    }
  }
  if ('prefixList' in rule.source && !PREFIX_LISTS[rule.source.prefixList]) return `Prefix list ${rule.source.prefixList} does not exist.`;
  return null;
}

export function addSgRule(board0: Board, sgId: string, direction: 'inbound' | 'outbound', rule: SgRuleInput): OpResult {
  const sg0 = board0.securityGroups[sgId];
  if (!sg0) return { ok: false, error: 'Unknown security group.' };
  const err = validateSgRule(board0, sg0, rule);
  if (err) return { ok: false, error: err };
  const { action: _a, ...clean } = rule;
  const board = clone(board0);
  const list = board.securityGroups[sgId][direction];
  if (list.some((r) => JSON.stringify({ ...r, description: undefined }) === JSON.stringify({ ...clean, description: undefined })))
    return { ok: false, error: 'the specified rule already exists (InvalidPermission.Duplicate).' };
  list.push(clean);
  return { ok: true, board };
}

export function removeSgRule(board0: Board, sgId: string, direction: 'inbound' | 'outbound', index: number): OpResult {
  const board = clone(board0);
  const sg = board.securityGroups[sgId];
  if (!sg) return { ok: false, error: 'Unknown security group.' };
  sg[direction].splice(index, 1);
  return { ok: true, board };
}

export function attachSecurityGroups(board0: Board, id: ComponentId, sgIds: string[]): OpResult {
  const board = clone(board0);
  const c = board.components[id];
  if (!c) return { ok: false, error: 'Unknown component.' };
  if (sgIds.length === 0) return { ok: false, error: 'A network interface must have at least one security group.' };
  if (sgIds.length > 5) return { ok: false, error: 'You can attach at most 5 security groups to a network interface.' };
  c.securityGroupIds = [...sgIds];
  return { ok: true, board };
}

export function createSecurityGroup(board0: Board, vpcId: string, name: string): OpResult {
  const board = clone(board0);
  if (Object.values(board.securityGroups).some((s) => s.name === name && s.vpcId === vpcId)) return { ok: false, error: `A security group named ${name} already exists in this VPC.` };
  const id = nextId(board, 'sg');
  board.securityGroups[id] = { id, name, vpcId, inbound: [], outbound: [{ protocol: 'all', fromPort: 0, toPort: 65535, source: { cidr: '0.0.0.0/0' } }] };
  return { ok: true, board, id };
}

// ---------- NACLs ----------

export function addNaclRule(board0: Board, naclId: string, direction: 'inbound' | 'outbound', rule: NaclRule): OpResult {
  const n = board0.nacls[naclId];
  if (!n) return { ok: false, error: 'Unknown network ACL.' };
  const err = validateNaclRule(n[direction], rule);
  if (err) return { ok: false, error: err };
  const board = clone(board0);
  board.nacls[naclId][direction].push({ ...rule });
  return { ok: true, board };
}

export function removeNaclRule(board0: Board, naclId: string, direction: 'inbound' | 'outbound', ruleNumber: number): OpResult {
  const board = clone(board0);
  const n = board.nacls[naclId];
  if (!n) return { ok: false, error: 'Unknown network ACL.' };
  n[direction] = n[direction].filter((r) => r.ruleNumber !== ruleNumber);
  return { ok: true, board };
}

export function createNacl(board0: Board, vpcId: string, name: string, fixedId?: string): OpResult {
  const board = clone(board0);
  if (fixedId && board.nacls[fixedId]) return { ok: false, error: `Network ACL ${fixedId} already exists.` };
  const id = fixedId ?? nextId(board, 'acl');
  // A new custom NACL denies everything until you add rules (only the default NACL allows all).
  board.nacls[id] = { id, name, vpcId, inbound: [], outbound: [] };
  return { ok: true, board, id };
}

// ---------- Route tables ----------

export function validateRoute(board: Board, rtId: string, route: Route): string | null {
  const rt = board.routeTables[rtId];
  if (!rt) return 'Unknown route table.';
  if (!PREFIX_LISTS[route.dest] && !isValidCidr(route.dest)) return `"${route.dest}" is not a valid destination CIDR block.`;
  if (isValidCidr(route.dest) && !isCanonicalCidr(route.dest)) return `${route.dest} is not a valid network address (host bits must be zero).`;
  if (rt.routes.some((r) => r.dest === route.dest)) return `A route for ${route.dest} already exists in ${rt.name} (RouteAlreadyExists).`;
  if (route.target === 'local') return 'The local route is created automatically for the VPC CIDR and cannot be added.';
  const vpc = board.regions.flatMap((r) => r.vpcs).find((v) => v.id === rt.vpcId);
  if (vpc && isValidCidr(route.dest) && cidrsOverlap(route.dest, vpc.cidr) && cidrContainsCidr(vpc.cidr, route.dest))
    return `${route.dest} is inside the VPC CIDR ${vpc.cidr}; traffic there is always handled by the local route.`;
  const tid = targetId(route.target);
  const kind = targetKind(route.target);
  const tc = tid ? board.components[tid] : undefined;
  if (!tc || tc.type !== kind) return `The ${kind} target ${tid} does not exist.`;
  if (kind === 'vpce') return 'Gateway endpoint routes are added by associating the endpoint with this route table.';
  if (kind === 'pcx') {
    const cfg = tc.config as ConfigOf<'pcx'>;
    if (!cfg.peerVpcId || (tc.placement.refId !== rt.vpcId && cfg.peerVpcId !== rt.vpcId)) return `${tc.name} does not involve this VPC, so it can't be a route target here.`;
  }
  if (kind === 'tgw' && !(tc.config as ConfigOf<'tgw'>).vpcAttachments.includes(rt.vpcId)) return `This VPC is not attached to ${tc.name}. Create a VPC attachment first.`;
  if (kind === 'vgw' && tc.placement.refId !== rt.vpcId) return `${tc.name} is attached to another VPC.`;
  return null;
}

export function addRoute(board0: Board, rtId: string, route: Route): OpResult {
  const err = validateRoute(board0, rtId, route);
  if (err) return { ok: false, error: err };
  const board = clone(board0);
  board.routeTables[rtId].routes.push({ dest: route.dest, target: route.target });
  return { ok: true, board };
}

export function removeRoute(board0: Board, rtId: string, dest: string): OpResult {
  const rt = board0.routeTables[rtId];
  if (!rt) return { ok: false, error: 'Unknown route table.' };
  const r = rt.routes.find((x) => x.dest === dest);
  if (r?.target === 'local') return { ok: false, error: 'The local route cannot be deleted.' };
  const board = clone(board0);
  board.routeTables[rtId].routes = rt.routes.filter((x) => x.dest !== dest);
  return { ok: true, board };
}

export function setRouteTarget(board0: Board, rtId: string, dest: string, target: RouteTarget): OpResult {
  const board = clone(board0);
  const rt = board.routeTables[rtId];
  if (!rt) return { ok: false, error: 'Unknown route table.' };
  const r = rt.routes.find((x) => x.dest === dest);
  if (!r) return { ok: false, error: 'Unknown route.' };
  if (r.target === 'local') return { ok: false, error: 'The local route cannot be changed.' };
  r.target = target;
  return { ok: true, board };
}

export function associateSubnet(board0: Board, subnetId: string, field: 'routeTableId' | 'naclId', value: string): OpResult {
  const board = clone(board0);
  const f = findSubnet(board, subnetId);
  if (!f) return { ok: false, error: 'Unknown subnet.' };
  const exists = field === 'routeTableId' ? board.routeTables[value] : board.nacls[value];
  if (!exists) return { ok: false, error: 'Unknown table.' };
  (f.subnet as Subnet)[field] = value;
  return { ok: true, board };
}

export { subnetPublicStatus };
