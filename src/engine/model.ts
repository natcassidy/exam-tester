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
  | 'vpce';

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
}

// ---------- Service configs ----------

export type InstanceType = 't3.micro' | 't3.small' | 't3.medium' | 't3.large' | 'm5.large' | 'c5.large' | 'm5.xlarge';
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
}

export type BucketPolicyPreset = 'none' | 'public-read' | 'cloudfront-oac' | 'custom';

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
}

export interface CloudFrontConfig {
  type: 'cloudfront';
  originId: ComponentId | null;
  oac: boolean;
  viewerProtocol: 'allow-all' | 'redirect-to-https' | 'https-only';
  cacheHitRatio: number;
}

export interface Route53Config {
  type: 'route53';
  recordName: string;
  aliasTargetId: ComponentId | null;
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
  | VpceConfig;

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

export type Endpoint = ComponentId | 'internet' | 'svc:s3' | 'svc:dynamodb';

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
  | 'iam';

export interface HopAt {
  kind: 'component' | 'subnet' | 'igw' | 'nat' | 'vpce' | 'internet' | 'service' | 'routeTable' | 'sg' | 'nacl' | 'role' | 'key';
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

export type PathVia = 'local' | 'igw' | 'nat' | 'vpce' | 'edge' | 'none';

export interface Trace {
  result: 'delivered' | 'dropped';
  hops: Hop[];
  returnHops: Hop[];
  /** How the forward path left the VPC, for cost and expectations. */
  via: PathVia;
  latencyMs?: number;
  /** Per-source-subnet results for multi-subnet sources. */
  paths?: { subnetId: string; result: 'delivered' | 'dropped'; via: PathVia }[];
}

// ---------- Simulation ----------

export type EventKind = 'reachability' | 'traffic' | 'azOutage' | 'audit' | 'queueBehavior' | 'bill' | 'iamAccess' | 'fleetHealth';

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

export interface VpcLayout {
  regionId: string;
  regionName: string;
  vpc?: {
    id: string;
    cidr: string;
    azs: { id: string; name: string }[];
    subnets: LayoutSubnet[];
    routeTables: { id: string; name: string; routes: Route[] }[];
    /** Pre-placed IGW (prewired in helpful missions). */
    igw?: boolean;
  };
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
