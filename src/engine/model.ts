// Core types for the Blast Radius engine. Pure TypeScript: no React or DOM imports.

import type { IamDecision, IamState, PolicyDocument } from './iam/types';

export type ComponentId = string;
export type ConceptId = string;
export type QuestionId = string;

export type ZoneType = 'edge' | 'region' | 'vpcAttach' | 'subnet' | 'onprem';

export type Domain = 'secure' | 'resilient' | 'performant' | 'cost';

export const DOMAIN_LABELS: Record<Domain, string> = {
  secure: 'Design Secure Architectures',
  resilient: 'Design Resilient Architectures',
  performant: 'Design High-Performing Architectures',
  cost: 'Design Cost-Optimized Architectures',
};

export type ServiceType =
  | 'alb'
  | 'ec2'
  | 'asg'
  | 'rds'
  | 's3'
  | 'sqs'
  | 'lambda'
  | 'apigw'
  | 'dynamodb'
  | 'cloudfront'
  | 'route53'
  | 'waf'
  | 'nat'
  | 'igw'
  | 'vpce'
  // Stage 3: multi-Region, hybrid, storage, data.
  | 'aurora'
  | 'pcx'
  | 'tgw'
  | 'vgw'
  | 'cgw'
  | 'vpn'
  | 'dx'
  | 'backup'
  | 'kinesis'
  | 'firehose'
  | 'athena'
  | 'snow'
  | 'datasync'
  | 'dms'
  // Stage 4: purchase commitments (Savings Plans / Reserved Instances).
  | 'savings';

// ---------- Board ----------

export interface Board {
  regions: Region[];
  edge: ComponentId[];
  components: Record<ComponentId, Component>;
  routeTables: Record<string, RouteTable>;
  securityGroups: Record<string, SecurityGroup>;
  nacls: Record<string, Nacl>;
  /** Roles, users, KMS keys and SCPs (Stage 2). Absent on older saves. */
  iam?: IamState;
  /** Monotonic counter used to mint deterministic ids. */
  seq: number;
  /** On-premises data centre (Stage 3). */
  onprem?: OnPrem;
}

export interface OnPrem {
  id: 'onprem';
  name: string;
  cidr: string;
  /** Internet uplink of the data centre, used for VPN throughput and online transfers. */
  internetMbps: number;
  components: ComponentId[];
}

export interface Region {
  id: string;
  name: string;
  vpcs: Vpc[];
  regionalServices: ComponentId[];
}

export interface Vpc {
  id: string;
  cidr: string;
  /** Owning AWS account (Stage 3 accounts layer). Absent = the board's own account. */
  accountId?: string;
  name?: string;
  azs: Az[];
  attachments: ComponentId[];
}

export interface Az {
  id: string;
  name: string;
  subnets: Subnet[];
}

export interface Subnet {
  id: string;
  name: string;
  cidr: string;
  azId: string;
  /** Layout row used for display only (e.g. "public", "app", "data"). Never used for logic. */
  tier: string;
  routeTableId: string;
  naclId: string;
  components: ComponentId[];
}

export interface Placement {
  kind: ZoneType;
  refId: string;
}

export interface Component {
  id: ComponentId;
  type: ServiceType;
  name: string;
  placement: Placement;
  subnets?: string[];
  securityGroupIds?: string[];
  config: ServiceConfig;
  locked?: boolean;
  /** IAM role the component runs as: EC2 instance profile or Lambda execution role. */
  roleId?: string;
  /** Owning AWS account (Stage 3). Absent = the board's own account. */
  accountId?: string;
}

// ---------- Service configs ----------

export type InstanceType = 't3.micro' | 't3.small' | 't3.medium' | 't3.large' | 'm5.large' | 'm5a.large' | 'm6i.large' | 'c5.large' | 'm5.xlarge';
export type DbInstanceClass = 'db.t3.micro' | 'db.t3.medium' | 'db.r5.large' | 'db.r5.xlarge';

export interface AlbConfig {
  type: 'alb';
  scheme: 'internet-facing' | 'internal';
  listener: { port: number; protocol: 'HTTP' | 'HTTPS' };
  targetId: ComponentId | null;
  targetPort: number;
  healthCheck: { path: string; intervalSec: number; timeoutSec: number; healthyThreshold: number; unhealthyThreshold: number };
  crossZone: boolean;
}

export interface AppSpec {
  port: number;
  healthPath: string;
}

export interface Ec2Config {
  type: 'ec2';
  instanceType: InstanceType;
  publicIp: boolean;
  app: AppSpec;
}

export type ScalingPolicy =
  | { kind: 'none' }
  | { kind: 'targetTracking'; targetCpu: number }
  | { kind: 'step'; upperCpu: number; addInstances: number }
  | { kind: 'scheduled'; actions: { atMin: number; desired: number }[] };

export type SpotAllocation = 'lowest-price' | 'capacity-optimized' | 'price-capacity-optimized';

/** Stage 4: mixed instances policy (On-Demand base + Spot above it). */
export interface PurchaseOptions {
  /** Instances always launched On-Demand, whatever the Spot market does. */
  onDemandBase: number;
  /** Share of capacity above the base launched as Spot (0-100). */
  spotPercent: number;
  allocation: SpotAllocation;
  /** More instance types the group may launch (each type × AZ is a separate Spot pool). */
  extraTypes: InstanceType[];
}

export interface AsgConfig {
  type: 'asg';
  instanceType: InstanceType;
  publicIp: boolean;
  min: number;
  max: number;
  desired: number;
  policy: ScalingPolicy;
  warmupSec: number;
  healthCheckType: 'EC2' | 'ELB';
  healthCheckGraceSec: number;
  app: AppSpec;
  /** Stage 4: Spot / On-Demand mix. Absent = all On-Demand. */
  purchase?: PurchaseOptions;
}

export interface RdsConfig {
  type: 'rds';
  engine: 'mysql' | 'postgres';
  port: number;
  instanceClass: DbInstanceClass;
  multiAz: boolean;
  backupRetentionDays: number;
  readReplicas: number;
  publiclyAccessible: boolean;
  storageEncrypted: boolean;
  allocatedStorageGb: number;
  /** This instance is a read replica of another RDS instance (cross-Region when it lives in another Region). */
  replicaOf?: ComponentId | null;
}

export type AuroraInstanceClass = 'db.r6g.large' | 'db.r6g.xlarge' | 'db.r6g.2xlarge';

export interface AuroraConfig {
  type: 'aurora';
  engine: 'aurora-mysql' | 'aurora-postgresql';
  port: number;
  instanceClass: AuroraInstanceClass;
  /** Aurora Replicas in the cluster (reader endpoint). Failover promotes one. */
  readers: number;
  serverlessV2: boolean;
  minAcu: number;
  maxAcu: number;
  backupRetentionDays: number;
  storageEncrypted: boolean;
  publiclyAccessible: boolean;
  /** Secondary cluster of an Aurora Global Database whose primary is this component. */
  globalPrimaryId: ComponentId | null;
}

export type BucketPolicyPreset = 'none' | 'public-read' | 'cloudfront-oac' | 'custom';

export type S3StorageClass = 'STANDARD' | 'INTELLIGENT_TIERING' | 'STANDARD_IA' | 'ONEZONE_IA' | 'GLACIER_IR' | 'GLACIER' | 'DEEP_ARCHIVE';

export interface LifecycleTransition {
  afterDays: number;
  toClass: S3StorageClass;
}

export interface S3Config {
  type: 's3';
  blockPublicAccess: boolean;
  versioning: boolean;
  encryption: 'SSE-S3' | 'SSE-KMS';
  policy: BucketPolicyPreset;
  /** CloudFront distribution the cloudfront-oac policy grants. */
  policyDistributionId: ComponentId | null;
  staticWebsite: boolean;
  /** The bucket policy when `policy` is 'custom'. */
  customPolicy?: PolicyDocument | null;
  /** Customer managed key for SSE-KMS (null = the AWS managed key aws/s3). */
  kmsKeyId?: string | null;
  // Stage 3: storage classes, lifecycle, data protection, replication.
  storageClass?: S3StorageClass;
  lifecycle?: LifecycleTransition[];
  /** Lifecycle expiration (days after creation); null = keep forever. */
  expireAfterDays?: number | null;
  objectLock?: { mode: 'none' | 'governance' | 'compliance'; retentionDays: number };
  mfaDelete?: boolean;
  /** Replication rule to another bucket (CRR when the destination is in another Region). */
  replication?: { destId: ComponentId | null; replicateDeletes: boolean };
}

export interface SqsConfig {
  type: 'sqs';
  fifo: boolean;
  visibilityTimeoutSec: number;
  retentionSec: number;
  dlqId: ComponentId | null;
  maxReceiveCount: number;
  sse: boolean;
  /** Queue (resource-based) policy. */
  policyDoc?: PolicyDocument | null;
}

export interface LambdaConfig {
  type: 'lambda';
  memoryMb: number;
  timeoutSec: number;
  reservedConcurrency: number | null;
  eventSourceId: ComponentId | null;
  coldStartMs: number;
  /** Kinesis event sources only: read through an enhanced fan-out consumer (dedicated 2 MB/s per shard). */
  enhancedFanOut?: boolean;
}

export interface ApiGwConfig {
  type: 'apigw';
  integration: { kind: 'lambda' | 'sqs'; targetId: ComponentId | null };
  throttleRps: number;
  burst: number;
}

export interface DynamoConfig {
  type: 'dynamodb';
  billingMode: 'onDemand' | 'provisioned';
  wcu: number;
  rcu: number;
  pitr: boolean;
  /** Global table replicas in other Regions (Stage 3). */
  replicaRegions?: string[];
  /** A DAX cluster in front of the table in every Region it lives in. */
  dax?: boolean;
}

export interface CloudFrontConfig {
  type: 'cloudfront';
  originId: ComponentId | null;
  oac: boolean;
  viewerProtocol: 'allow-all' | 'redirect-to-https' | 'https-only';
  cacheHitRatio: number;
}

export type Route53Policy = 'simple' | 'weighted' | 'latency' | 'failover' | 'geolocation' | 'geoproximity' | 'multivalue';

export interface Route53Record {
  id: string;
  targetId: ComponentId | null;
  /** Health check (or Evaluate Target Health on an alias): unhealthy records stop being returned. */
  healthCheck: boolean;
  weight?: number;
  failover?: 'primary' | 'secondary';
  /** Geolocation: continent code (NA, SA, EU, AS, OC, AF) or '*' for the default record. */
  location?: string;
  /** Geoproximity bias (-99..99). */
  bias?: number;
}

export interface Route53Config {
  type: 'route53';
  recordName: string;
  /** The target for simple routing. */
  aliasTargetId: ComponentId | null;
  // Stage 3: routing policies, health checks and TTL.
  policy?: Route53Policy;
  records?: Route53Record[];
  /** Alias records answer with the target's TTL (60 s for load balancers); others use ttlSec. */
  alias?: boolean;
  ttlSec?: number;
  healthCheck?: { intervalSec: 10 | 30; failureThreshold: number };
}

export interface WafConfig {
  type: 'waf';
  associatedId: ComponentId | null;
  managedRules: boolean;
  rateLimitPer5Min: number | null;
}

export interface NatConfig {
  type: 'nat';
}

export interface IgwConfig {
  type: 'igw';
}

export interface VpceConfig {
  type: 'vpce';
  service: 's3' | 'dynamodb';
  routeTableIds: string[];
  /** Endpoint policy (null = the default full-access policy). */
  policyDoc?: PolicyDocument | null;
}

// ---------- Stage 3 configs ----------

export interface PcxConfig {
  type: 'pcx';
  /** The accepter VPC. The requester is the VPC this connection is attached to. */
  peerVpcId: string | null;
}

export interface TgwRouteTable {
  id: string;
  name: string;
  /** Attachments (VPC ids, or VPN / DX component ids) that use this table for lookups. */
  associations: string[];
  /** Attachments whose CIDRs are propagated into this table. */
  propagations: string[];
  routes: { dest: string; attachment: string | 'blackhole' }[];
}

export interface TgwConfig {
  type: 'tgw';
  /** VPC attachments, by VPC id. VPN and DX attachments come from connections attached to this TGW. */
  vpcAttachments: string[];
  routeTables: TgwRouteTable[];
  /** Shared with other accounts through AWS RAM. */
  ramShared: boolean;
}

export interface VgwConfig {
  type: 'vgw';
}

export interface CgwConfig {
  type: 'cgw';
  bgpAsn: number;
}

export interface VpnConfig {
  type: 'vpn';
  cgwId: ComponentId | null;
  /** Virtual private gateway or transit gateway. */
  attachTo: ComponentId | null;
}

export interface DxConfig {
  type: 'dx';
  speedGbps: 1 | 10 | 100;
  /** Virtual private gateway or transit gateway (through a Direct Connect gateway). */
  attachTo: ComponentId | null;
  /** DX is not encrypted by default: MACsec (10/100 Gbps dedicated) or an IPsec VPN over the connection. */
  encryption: 'none' | 'macsec' | 'ipsec-vpn';
}

export interface BackupConfig {
  type: 'backup';
  resourceIds: ComponentId[];
  frequencyHours: number;
  retentionDays: number;
  /** Copy every recovery point to a vault in another Region. */
  copyRegion: string | null;
  /** The copy vault lives in a separate backup account. */
  copyToOtherAccount: boolean;
  vaultLock: 'none' | 'governance' | 'compliance';
}

export interface KinesisConfig {
  type: 'kinesis';
  mode: 'provisioned' | 'onDemand';
  shards: number;
  retentionHours: number;
}

export interface FirehoseConfig {
  type: 'firehose';
  /** Kinesis data stream to read from; null = Direct PUT from producers. */
  sourceId: ComponentId | null;
  destId: ComponentId | null;
  bufferSec: number;
  bufferMb: number;
  format: 'json' | 'parquet';
}

export interface AthenaConfig {
  type: 'athena';
  sourceId: ComponentId | null;
}

export interface SnowConfig {
  type: 'snow';
  devices: number;
  destId: ComponentId | null;
}

export interface DataSyncConfig {
  type: 'datasync';
  destId: ComponentId | null;
  schedule: 'once' | 'hourly' | 'daily';
}

export interface DmsConfig {
  type: 'dms';
  targetId: ComponentId | null;
  mode: 'full-load' | 'full-load-and-cdc';
}

// ---------- Stage 4 configs ----------

export type CommitmentPlan = 'compute-sp' | 'ec2-instance-sp' | 'standard-ri' | 'convertible-ri';

/** A pricing commitment for the account. It is not a resource: it changes what usage costs. */
export interface SavingsConfig {
  type: 'savings';
  plan: CommitmentPlan;
  termYears: 1 | 3;
  /** Savings Plans: committed spend in $/hour (at the discounted rate). */
  hourlyCommit: number;
  /** EC2 Instance Savings Plan: the family is taken from this type. Reserved Instances: the type reserved. */
  instanceType: InstanceType;
  /** Reserved Instances: how many. */
  count: number;
}

export type ServiceConfig =
  | AlbConfig
  | Ec2Config
  | AsgConfig
  | RdsConfig
  | S3Config
  | SqsConfig
  | LambdaConfig
  | ApiGwConfig
  | DynamoConfig
  | CloudFrontConfig
  | Route53Config
  | WafConfig
  | NatConfig
  | IgwConfig
  | VpceConfig
  | AuroraConfig
  | PcxConfig
  | TgwConfig
  | VgwConfig
  | CgwConfig
  | VpnConfig
  | DxConfig
  | BackupConfig
  | KinesisConfig
  | FirehoseConfig
  | AthenaConfig
  | SnowConfig
  | DataSyncConfig
  | DmsConfig
  | SavingsConfig;

export type ConfigOf<T extends ServiceType> = Extract<ServiceConfig, { type: T }>;

// ---------- Network objects ----------

export type RouteTarget =
  | 'local'
  | { igw: string }
  | { nat: string }
  | { vpce: string }
  | { pcx: string }
  | { tgw: string }
  | { vgw: string };

export interface Route {
  dest: string; // CIDR or prefix list id such as "pl-s3"
  target: RouteTarget;
  /** Set when the route is propagated by a gateway endpoint association (not user-editable). */
  propagated?: boolean;
}

export interface RouteTable {
  id: string;
  name: string;
  vpcId: string;
  routes: Route[];
}

export type Protocol = 'tcp' | 'udp' | 'icmp' | 'all';

export type SgSource = { cidr: string } | { sg: string } | { prefixList: string };

export interface SgRule {
  protocol: Protocol;
  fromPort: number;
  toPort: number;
  source: SgSource; // for outbound rules this is the destination
  description?: string;
}

export interface SecurityGroup {
  id: string;
  name: string;
  vpcId: string;
  inbound: SgRule[];
  outbound: SgRule[];
}

export interface NaclRule {
  ruleNumber: number;
  protocol: Protocol;
  portRange: [number, number];
  cidr: string;
  action: 'allow' | 'deny';
}

export interface Nacl {
  id: string;
  name: string;
  vpcId: string;
  inbound: NaclRule[];
  outbound: NaclRule[];
}

// ---------- Trace ----------

export type Endpoint = ComponentId | 'internet' | 'svc:s3' | 'svc:dynamodb' | 'onprem';

export interface Flow {
  from: Endpoint;
  to: Endpoint;
  protocol: Protocol;
  port: number;
  /** Where an internet client sits, for latency estimates. */
  clientCity?: string;
}

export type HopCheck =
  | 'sg-out'
  | 'nacl-out'
  | 'route'
  | 'igw'
  | 'nat'
  | 'vpce'
  | 'nacl-in'
  | 'sg-in'
  | 'lb-listener'
  | 'lb-target-health'
  | 'public-ip'
  | 'dns'
  | 'edge'
  | 'origin'
  | 'az'
  | 'exists'
  | 'endpoint-policy'
  | 'iam'
  | 'peering'
  | 'tgw'
  | 'vpn'
  | 'dx'
  | 'region';

export interface HopAt {
  kind: 'component' | 'subnet' | 'igw' | 'nat' | 'vpce' | 'internet' | 'service' | 'routeTable' | 'sg' | 'nacl' | 'role' | 'key' | 'onprem';
  id: string;
}

export interface Hop {
  at: HopAt;
  check: HopCheck;
  result: 'allow' | 'deny' | 'info';
  matched?: { objectId: string; ruleRef: string };
  explain: string;
  /** Full permission evaluation behind an 'iam' hop. */
  iam?: IamDecision;
}

export type PathVia = 'local' | 'igw' | 'nat' | 'vpce' | 'edge' | 'none' | 'pcx' | 'tgw' | 'vpn' | 'dx';

export interface Trace {
  result: 'delivered' | 'dropped';
  hops: Hop[];
  returnHops: Hop[];
  /** How the forward path left the VPC, for cost and expectations. */
  via: PathVia;
  latencyMs?: number;
  /** Per-source-subnet results for multi-subnet sources. */
  paths?: { subnetId: string; result: 'delivered' | 'dropped'; via: PathVia }[];
  /** VPN or Direct Connect connection that carried the flow (Stage 3). */
  linkId?: string;
}

// ---------- Simulation ----------

export type EventKind =
  | 'reachability'
  | 'traffic'
  | 'azOutage'
  | 'audit'
  | 'queueBehavior'
  | 'bill'
  | 'iamAccess'
  | 'fleetHealth'
  // Stage 3
  | 'regionOutage'
  | 'dataLoss'
  | 'migration'
  | 'connectivity'
  | 'globalLatency'
  | 'storageLifecycle'
  | 'streamIngest'
  // Stage 4
  | 'spotReclaim'
  | 'commitment';

export interface EventSpec {
  id: string;
  name: string;
  desc: string;
  domain: Domain;
  concepts: ConceptId[];
  kind: EventKind;
  params: any;
  requirementIds?: string[];
  /** The mission validator expects this event to pass on an empty board. */
  passesOnEmptyBoard?: boolean;
}

export interface TimelinePoint {
  min: number;
  demand: number;
  capacity: number;
  errors: number;
  p95: number;
  instances?: number;
  depth?: number;
}

export interface TimelineSeries {
  points: TimelinePoint[];
  marks?: { min: number; label: string }[];
}

export interface EventDetail {
  lines: { label: string; value: string; status?: 'pass' | 'warn' | 'fail' }[];
  lineItems?: CostLineItem[];
}

export interface EventResult {
  eventId: string;
  status: 'pass' | 'warn' | 'fail';
  summary: string;
  detail?: EventDetail;
  lesson: string;
  manual: ConceptId[];
  highlight: ComponentId[];
  /** Object to open with "Fix it" (component, subnet, SG, NACL or route table id). */
  fixTarget?: string;
  trace?: Trace;
  timeline?: TimelineSeries;
  metrics?: Record<string, number>;
}

// ---------- Cost ----------

export interface UsageFlow {
  from: ComponentId | string; // component id or selector (type)
  to: Endpoint | 'internet';
  gbPerMonth: number;
}

export interface UsageProfile {
  requestsPerMonth: number;
  /** Data served to internet users per month (GB). */
  dataOutGb: number;
  s3StorageGb: number;
  s3GetRequests: number;
  s3PutRequests: number;
  flows: UsageFlow[];
  lambdaGbSeconds?: number;
  sqsRequests?: number;
  dynamoWrites?: number;
  dynamoReads?: number;
  dynamoStorageGb?: number;
  rdsStorageGb?: number;
  // Stage 3
  /** Data crossing between Regions per month (replication, cross-Region reads). */
  crossRegionGb?: number;
  /** Data between VPCs (peering or Transit Gateway) per month. */
  interVpcGb?: number;
  /** Data from AWS to on-premises over VPN / Direct Connect per month. */
  hybridOutGb?: number;
  /** Bytes protected by AWS Backup (per protected resource). */
  backupGb?: number;
  /** Streaming ingest. */
  streamEventsPerSec?: number;
  streamAvgKb?: number;
  /** Data Athena would scan per month if it were stored as JSON. */
  athenaJsonTbScanned?: number;
  /** One-time migration volume, shown amortised over one month. */
  migrationTb?: number;
  /** Data changed during the migration window that an online sync has to copy. */
  migrationChangeGb?: number;
  // Stage 4
  /** Average database queries per second, used to size Aurora Serverless v2 capacity. */
  dbAvgQps?: number;
}

export interface CostLineItem {
  service: string;
  item: string;
  monthly: number;
  componentId?: ComponentId;
}

// ---------- Missions & content ----------

export interface LayoutSubnet {
  id: string;
  name: string;
  cidr: string;
  az: string;
  tier: string;
  routeTableId: string;
  naclId?: string;
}

export interface VpcSpec {
  id: string;
  cidr: string;
  name?: string;
  accountId?: string;
  azs: { id: string; name: string }[];
  subnets: LayoutSubnet[];
  routeTables: { id: string; name: string; routes: Route[] }[];
  /** Pre-placed IGW (prewired in helpful missions). Its id is igw-1 for the first VPC, igw-<vpc id> otherwise. */
  igw?: boolean;
}

export interface VpcLayout {
  regionId: string;
  regionName: string;
  vpc?: VpcSpec;
  /** Stage 3: more VPCs, in this Region or in others. */
  extraVpcs?: { regionId: string; regionName: string; vpc?: VpcSpec }[];
  /** Stage 3: an on-premises data centre. */
  onprem?: { name: string; cidr: string; internetMbps: number };
}

export interface Requirement {
  id: string;
  text: string;
  target?: { rtoSec?: number; rpoSec?: number; budget?: number; p95Ms?: number };
}

export interface MistakeSpec {
  name: string;
  board: Board;
  expectFail: string[];
}

export interface Mission {
  id: string;
  stage: 1 | 2 | 3 | 4;
  mode: 'build' | 'incident' | 'diff' | 'refactor';
  title: string;
  client: string;
  users: string;
  brief: string;
  requirements: Requirement[];
  budget: number;
  usage: UsageProfile;
  defaults: 'helpful' | 'bare';
  layout: VpcLayout;
  palette?: ServiceType[];
  events: EventSpec[];
  questions: QuestionId[];
  concepts: ConceptId[];
  reference: Board;
  mistakes: MistakeSpec[];
  keywords: string[];
  /** Short hint shown in the brief describing what a good design contains. */
  hints?: string[];
  /** Incidents start from this prebuilt, broken board instead of the empty layout. */
  startingBoard?: Board;
  incident?: IncidentSpec;
  diff?: DiffSpec;
  /** Stage 4 refactor missions: the requirement change and how cost is measured. */
  refactor?: RefactorSpec;
}

// ---------- Refactors (Stage 4) ----------

export interface RefactorSpec {
  /** The requirement change that kicks off the refactor, in the client's words. */
  change: string;
  /** Events whose `metrics.monthly` add up to the cost being optimised (default: every bill event). */
  costEvents?: string[];
}

// ---------- Incidents (Stage 2) ----------

export interface LogSource {
  id: string;
  kind: 'alb' | 'flow' | 'cloudtrail' | 'cloudwatch' | 'app';
  title: string;
  /** What the source is, in one line (shown above the lines). */
  note?: string;
  lines: string[];
}

export interface IncidentSpec {
  alert: { title: string; detail: string };
  /** Investigation actions available (opening a console panel, ad-hoc trace, viewing a log). */
  budget: number;
  /** Actions a sharp investigator needs; using no more than this keeps the full 10%. */
  par: number;
  logs: LogSource[];
  /** Suspect id of the root cause (see engine/incident/suspects.ts), e.g. "nacl:acl-app:outbound". */
  rootCause: string;
  /** Plain-English explanation revealed in the report. */
  rootCauseExplain: string;
  /** Events that show the symptom: they must fail on the starting board. */
  symptomEvents: string[];
  /** Change keys a correct fix may touch (prefix match). Anything else is collateral. */
  allowedChanges: string[];
  /** Plausible wrong fixes: each must fail an event or be flagged as collateral. */
  wrongFixes: { name: string; board: Board; expectFail: string[]; collateral: boolean }[];
}

// ---------- Spot the Difference (Stage 2) ----------

export interface DiffOption {
  id: string;
  text: string;
  why: string;
  /** Change keys (from diffBoards) this option describes. Options must cover every real difference. */
  changes: string[];
}

export interface DiffSpec {
  left: Board;
  right: Board;
  leftLabel: string;
  rightLabel: string;
  /** Which side survives the event. */
  survivor: 'left' | 'right';
  question: string;
  options: DiffOption[];
  correct: string;
  explanation: string;
}

export interface Question {
  id: QuestionId;
  domain: Domain;
  concepts: ConceptId[];
  stem: string;
  options: { id: string; text: string; why: string }[];
  correct: string[];
  difficulty: 1 | 2 | 3;
}

export interface Concept {
  id: ConceptId;
  title: string;
  domain: Domain;
  task: string; // exam task statement, e.g. "1.2"
}
