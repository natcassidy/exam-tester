// Shared pieces for Course Labs: the lab factory, standard layouts and fallback "why not" notes.

import type { Board, ConceptId, CourseInfo, Mission, MistakeSpec, QuestionId, ServiceType, UsageProfile, VpcLayout, VpcSpec } from '../../engine/model';
import { QUESTIONS } from '../questions';

export const usage0: UsageProfile = { requestsPerMonth: 0, dataOutGb: 0, s3StorageGb: 0, s3GetRequests: 0, s3PutRequests: 0, flows: [] };

/** Up to five practice questions on the lab's concepts, taken in concept order. */
export function questionsFor(concepts: ConceptId[]): QuestionId[] {
  const out: QuestionId[] = [];
  for (let round = 0; out.length < 5 && round < 8; round++)
    for (const c of concepts) {
      const q = QUESTIONS.filter((x) => x.concepts.includes(c) && !out.includes(x.id))[0];
      if (q && out.length < 5) out.push(q.id);
    }
  return out;
}

/** What a service is for, said so it explains why a lab that doesn't need it leaves it out. */
const GENERIC_WHY_NOT: Record<ServiceType, string> = {
  alb: 'A load balancer spreads HTTP traffic over a fleet. Nothing in this lab sits behind one.',
  ec2: 'A single EC2 instance is a server you patch and replace yourself; this lab does not need one.',
  asg: 'An Auto Scaling group keeps a fleet of instances running. This lab has no fleet to manage.',
  rds: 'RDS is a managed relational database. This lab stores no relational data.',
  s3: 'S3 stores objects. Nothing in this lab needs object storage.',
  sqs: 'A queue decouples a producer from a consumer. This lab has no asynchronous work to buffer.',
  lambda: 'Lambda runs code on demand. This lab needs no code of its own.',
  apigw: 'API Gateway fronts an HTTP API. This lab exposes no API.',
  dynamodb: 'DynamoDB is a key-value table. This lab has no key-value data.',
  cloudfront: 'CloudFront caches content at the edge. Global latency is not what this lab is about.',
  route53: 'Route 53 answers DNS. This lab never resolves a name.',
  waf: 'AWS WAF filters HTTP requests at layer 7. No requirement here calls for request filtering.',
  nat: 'A NAT gateway gives private subnets outbound internet. Nothing private here needs the internet, and it bills per hour and per GB.',
  igw: 'An internet gateway connects a VPC to the internet. This lab already has the internet access it needs, or must not have any.',
  vpce: 'A gateway endpoint keeps S3 and DynamoDB traffic off the NAT. No private subnet here talks to either.',
  aurora: 'Aurora is a managed relational cluster. This lab does not need a relational database, or RDS already does the job for less.',
  pcx: 'Peering joins two VPCs. There is only one network to join here.',
  tgw: 'A transit gateway is a hub for many VPCs and on-premises links: far more than this lab needs.',
  vgw: 'A virtual private gateway terminates VPN and Direct Connect links. This lab has no on-premises network.',
  cgw: 'A customer gateway represents an on-premises router. There is no on-premises side here.',
  vpn: 'Site-to-Site VPN links an on-premises network. There is none in this lab.',
  dx: 'Direct Connect is a dedicated line from a data centre, and takes weeks to arrive. Not needed here.',
  backup: 'AWS Backup schedules copies of resources. The requirements here are met without scheduled backups.',
  kinesis: 'A Kinesis stream carries ordered, replayable real-time records. This lab has no stream of events.',
  firehose: 'Firehose loads streaming data into S3 or Redshift. Nothing here is streamed.',
  athena: 'Athena runs SQL over files in S3. Nobody needs to query data in this lab.',
  snow: 'A Snowball device ships terabytes offline. There is nothing to migrate here.',
  datasync: 'DataSync copies files from on-premises or between storage services. There is nothing to copy here.',
  dms: 'DMS migrates databases. There is no database migration in this lab.',
  savings: 'A Savings Plan or RI is a pricing commitment, not a resource. It changes no requirement in this lab.',
};

export interface LabInput extends Omit<Mission, 'stage' | 'mode' | 'questions' | 'mistakes' | 'startingBoard' | 'course' | 'defaults'> {
  course: CourseInfo;
  defaults?: Mission['defaults'];
  /** The pre-built board the player starts from (fix and finish labs), and the events it fails. */
  start?: { board: Board; fails: string[] };
  mistakes?: MistakeSpec[];
  questions?: QuestionId[];
}

export const HANDED_OVER = 'The board as handed over';

/** A Course Lab: a build mission tagged with its course section, with the starting board kept as a mistake so tests check it fails as described. */
export function lab(x: LabInput): Mission {
  const { start, course, ...rest } = x;
  const refTypes = new Set(Object.values(x.reference.components).map((c) => c.type));
  const whyNot: Partial<Record<ServiceType, string>> = {};
  for (const t of [...(x.palette ?? []), ...(x.distractors ?? [])]) if (!refTypes.has(t)) whyNot[t] = x.whyNot?.[t] ?? GENERIC_WHY_NOT[t];
  return {
    ...rest,
    stage: 1,
    mode: 'build',
    defaults: x.defaults ?? 'helpful',
    course,
    startingBoard: start?.board,
    questions: x.questions ?? questionsFor(x.concepts),
    mistakes: [...(start ? [{ name: HANDED_OVER, board: start.board, expectFail: start.fails }] : []), ...(x.mistakes ?? [])],
    whyNot,
  };
}

// ---------- Layouts ----------

export const regionOnly = (regionId = 'us-east-1', regionName = 'US East (N. Virginia)'): VpcLayout => ({ regionId, regionName });

const AZS = (r: string) => [
  { id: `${r}a`, name: `${r}a` },
  { id: `${r}b`, name: `${r}b` },
];

/** Public subnets only, with an internet gateway and a route to it. */
export function publicVpc(id: string, octet: number, region = 'us-east-1'): VpcSpec {
  return {
    id,
    cidr: `10.${octet}.0.0/16`,
    igw: true,
    azs: AZS(region),
    routeTables: [{ id: 'rtb-public', name: 'rtb-public', routes: [{ dest: '0.0.0.0/0', target: { igw: 'igw-1' } }] }],
    subnets: [
      { id: 'public-a', name: 'public-a', cidr: `10.${octet}.0.0/24`, az: `${region}a`, tier: 'public', routeTableId: 'rtb-public' },
      { id: 'public-b', name: 'public-b', cidr: `10.${octet}.1.0/24`, az: `${region}b`, tier: 'public', routeTableId: 'rtb-public' },
    ],
  };
}

/** Public, app and data subnets in two AZs; one private route table per AZ (no routes yet). */
export function threeTierVpc(id: string, octet: number, tiers: string[] = ['app', 'data']): VpcSpec {
  return {
    id,
    cidr: `10.${octet}.0.0/16`,
    igw: true,
    azs: AZS('us-east-1'),
    routeTables: [
      { id: 'rtb-public', name: 'rtb-public', routes: [{ dest: '0.0.0.0/0', target: { igw: 'igw-1' } }] },
      { id: 'rtb-private-a', name: 'rtb-private-a', routes: [] },
      { id: 'rtb-private-b', name: 'rtb-private-b', routes: [] },
    ],
    subnets: [
      { id: 'public-a', name: 'public-a', cidr: `10.${octet}.0.0/24`, az: 'us-east-1a', tier: 'public', routeTableId: 'rtb-public' },
      { id: 'public-b', name: 'public-b', cidr: `10.${octet}.1.0/24`, az: 'us-east-1b', tier: 'public', routeTableId: 'rtb-public' },
      ...tiers.flatMap((t, i) => [
        { id: `${t}-a`, name: `${t}-a`, cidr: `10.${octet}.${10 * (i + 1)}.0/24`, az: 'us-east-1a', tier: t, routeTableId: 'rtb-private-a' },
        { id: `${t}-b`, name: `${t}-b`, cidr: `10.${octet}.${10 * (i + 1) + 1}.0/24`, az: 'us-east-1b', tier: t, routeTableId: 'rtb-private-b' },
      ]),
    ],
  };
}

export const inRegion = (vpc: VpcSpec, regionId = 'us-east-1', regionName = 'US East (N. Virginia)'): VpcLayout => ({ regionId, regionName, vpc });
