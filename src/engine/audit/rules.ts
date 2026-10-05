// Reusable audit checks. Each returns 'na' when the board has nothing the rule applies to.

import type { Board, ComponentId, ConceptId } from '../model';
import { componentsOfType, subnetsOf } from '../board';
import { isPublicSubnet } from '../net/routing';

export interface AuditFinding {
  status: 'pass' | 'fail' | 'na';
  message: string;
  highlight: ComponentId[];
  fixTarget?: string;
}

export interface AuditRule {
  id: string;
  title: string;
  concept: ConceptId;
  check: (board: Board) => AuditFinding;
}

const na = (message: string): AuditFinding => ({ status: 'na', message, highlight: [] });

export const AUDIT_RULES: Record<string, AuditRule> = {
  dbNotPublic: {
    id: 'dbNotPublic',
    title: 'Databases are not publicly accessible',
    concept: 'vpc-public-private',
    check: (b) => {
      const dbs = componentsOfType(b, 'rds');
      if (!dbs.length) return na('No RDS database on the board.');
      for (const db of dbs) {
        if (db.config.publiclyAccessible) return { status: 'fail', message: `${db.name} has "Publicly accessible" set to Yes, so it gets a public IP address.`, highlight: [db.id], fixTarget: db.id };
        const pub = subnetsOf(db).filter((s) => isPublicSubnet(b, s));
        if (pub.length) return { status: 'fail', message: `${db.name}'s subnet group includes public subnet(s) (${pub.join(', ')}). Keep databases in private subnets.`, highlight: [db.id], fixTarget: db.id };
      }
      return { status: 'pass', message: 'Every database is private: not publicly accessible and only in private subnets.', highlight: [] };
    },
  },
  noSshFromWorld: {
    id: 'noSshFromWorld',
    title: 'No SSH/RDP open to the world',
    concept: 'security-groups',
    check: (b) => {
      const sgs = Object.values(b.securityGroups);
      if (!sgs.length) return na('No security groups on the board.');
      for (const sg of sgs)
        for (const r of sg.inbound) {
          const world = 'cidr' in r.source && r.source.cidr === '0.0.0.0/0';
          const covers = (p: number) => r.protocol === 'all' || (r.protocol === 'tcp' && r.fromPort <= p && r.toPort >= p);
          if (world && (covers(22) || covers(3389))) {
            const owner = Object.values(b.components).find((c) => c.securityGroupIds?.includes(sg.id));
            return { status: 'fail', message: `${sg.name} allows ${covers(22) ? 'SSH (22)' : 'RDP (3389)'} from 0.0.0.0/0. Use Session Manager instead of open admin ports.`, highlight: owner ? [owner.id] : [], fixTarget: sg.id };
          }
        }
      return { status: 'pass', message: 'No security group exposes SSH or RDP to 0.0.0.0/0.', highlight: [] };
    },
  },
  s3BlockPublicAccess: {
    id: 's3BlockPublicAccess',
    title: 'S3 Block Public Access is on',
    concept: 's3-block-public-access',
    check: (b) => {
      const buckets = componentsOfType(b, 's3');
      if (!buckets.length) return na('No S3 bucket on the board.');
      const off = buckets.find((x) => !x.config.blockPublicAccess);
      if (off) return { status: 'fail', message: `${off.name} has Block Public Access turned off.`, highlight: [off.id], fixTarget: off.id };
      return { status: 'pass', message: 'Block Public Access is on for every bucket.', highlight: [] };
    },
  },
  encryptionAtRest: {
    id: 'encryptionAtRest',
    title: 'Data is encrypted at rest',
    concept: 'encryption-at-rest',
    check: (b) => {
      const dbs = componentsOfType(b, 'rds');
      const qs = componentsOfType(b, 'sqs');
      const buckets = componentsOfType(b, 's3');
      const tables = componentsOfType(b, 'dynamodb');
      if (!dbs.length && !qs.length && !buckets.length && !tables.length) return na('No data stores on the board.');
      const db = dbs.find((d) => !d.config.storageEncrypted);
      if (db) return { status: 'fail', message: `${db.name} storage is not encrypted. RDS encryption must be chosen at creation; to fix an existing database, restore an encrypted copy of a snapshot.`, highlight: [db.id], fixTarget: db.id };
      const q = qs.find((x) => !x.config.sse);
      if (q) return { status: 'fail', message: `${q.name} has server-side encryption turned off.`, highlight: [q.id], fixTarget: q.id };
      return { status: 'pass', message: 'All data stores encrypt at rest (S3 and DynamoDB always encrypt new data by default).', highlight: [] };
    },
  },
  appTierPrivate: {
    id: 'appTierPrivate',
    title: 'App servers are in private subnets',
    concept: 'vpc-public-private',
    check: (b) => {
      const apps = [...componentsOfType(b, 'asg'), ...componentsOfType(b, 'ec2')];
      if (!apps.length) return na('No EC2 instances or Auto Scaling groups on the board.');
      for (const a of apps) {
        if (a.config.publicIp) return { status: 'fail', message: `${a.name} assigns public IPs to its instances. Put app servers behind the load balancer with private addresses only.`, highlight: [a.id], fixTarget: a.id };
        const pub = subnetsOf(a).find((s) => isPublicSubnet(b, s));
        if (pub) return { status: 'fail', message: `${a.name} runs in a public subnet (${pub}).`, highlight: [a.id], fixTarget: a.id };
      }
      return { status: 'pass', message: 'App servers run in private subnets with no public IPs.', highlight: [] };
    },
  },
  privateTierSgsChained: {
    id: 'privateTierSgsChained',
    title: 'Private tiers only accept traffic from the tier in front',
    concept: 'sg-chaining',
    check: (b) => {
      const comps = [...componentsOfType(b, 'asg'), ...componentsOfType(b, 'ec2'), ...componentsOfType(b, 'rds')];
      if (!comps.length) return na('No private-tier components on the board.');
      for (const c of comps)
        for (const sgId of c.securityGroupIds ?? []) {
          const sg = b.securityGroups[sgId];
          const open = sg?.inbound.find((r) => 'cidr' in r.source && r.source.cidr === '0.0.0.0/0');
          if (open) return { status: 'fail', message: `${sg.name} (on ${c.name}) allows inbound from 0.0.0.0/0. Reference the security group of the tier in front instead (ALB SG → app SG → DB SG).`, highlight: [c.id], fixTarget: sg.id };
        }
      return { status: 'pass', message: 'App and data tiers only accept traffic from the security group in front of them.', highlight: [] };
    },
  },
  dbSgLeastPrivilege: {
    id: 'dbSgLeastPrivilege',
    title: 'Only the app tier can reach the database',
    concept: 'sg-chaining',
    check: (b) => {
      const dbs = componentsOfType(b, 'rds');
      if (!dbs.length) return na('No RDS database on the board.');
      const appSgs = new Set(Object.values(b.components).filter((c) => ['asg', 'ec2', 'lambda'].includes(c.type)).flatMap((c) => c.securityGroupIds ?? []));
      for (const db of dbs)
        for (const sgId of db.securityGroupIds ?? []) {
          const sg = b.securityGroups[sgId];
          for (const r of sg?.inbound ?? []) {
            if ('sg' in r.source && appSgs.has(r.source.sg)) continue;
            const src = 'cidr' in r.source ? r.source.cidr : 'sg' in r.source ? b.securityGroups[r.source.sg]?.name ?? r.source.sg : r.source.prefixList;
            return { status: 'fail', message: `${sg.name} (on ${db.name}) accepts traffic from ${src}. A database should only accept the app tier's security group: a CIDR or the load balancer's SG lets more than the app in.`, highlight: [db.id], fixTarget: sg.id };
          }
        }
      return { status: 'pass', message: 'Database security groups only reference the app tier security group.', highlight: [] };
    },
  },
  s3CustomerManagedKey: {
    id: 's3CustomerManagedKey',
    title: 'Regulated buckets use the customer managed KMS key',
    concept: 'kms-key-policies',
    check: (b) => {
      const buckets = componentsOfType(b, 's3');
      if (!buckets.length) return na('No S3 bucket on the board.');
      const off = buckets.find((x) => x.config.encryption !== 'SSE-KMS' || !x.config.kmsKeyId);
      if (off) return { status: 'fail', message: `${off.name} is not encrypted with the customer managed key. The compliance rule needs a key the company controls (key policy, rotation, CloudTrail record of every use); SSE-S3 or the AWS managed key don't give that.`, highlight: [off.id], fixTarget: off.id };
      return { status: 'pass', message: 'Every bucket uses SSE-KMS with a customer managed key.', highlight: [] };
    },
  },
  wafOnPublicEntry: {
    id: 'wafOnPublicEntry',
    title: 'Public entry points are protected by AWS WAF',
    concept: 'aws-waf',
    check: (b) => {
      const entries = [...componentsOfType(b, 'alb').filter((a) => a.config.scheme === 'internet-facing'), ...componentsOfType(b, 'cloudfront')];
      if (!entries.length) return na('No internet-facing entry point on the board.');
      const wafs = componentsOfType(b, 'waf');
      const unprotected = entries.find((e) => !wafs.some((w) => w.config.associatedId === e.id));
      if (unprotected) return { status: 'fail', message: `${unprotected.name} faces the internet without a WAF web ACL (SQL injection, XSS and rate-based rules).`, highlight: [unprotected.id], fixTarget: wafs[0]?.id ?? unprotected.id };
      return { status: 'pass', message: 'Every public entry point has a WAF web ACL associated.', highlight: [] };
    },
  },
  s3OriginAccessControl: {
    id: 's3OriginAccessControl',
    title: 'S3 origins are only reachable through CloudFront (OAC)',
    concept: 'cloudfront-oac',
    check: (b) => {
      const dists = componentsOfType(b, 'cloudfront').filter((d) => d.config.originId && b.components[d.config.originId]?.type === 's3');
      if (!dists.length) return na('No CloudFront distribution with an S3 origin.');
      for (const d of dists) {
        const bucket = b.components[d.config.originId!];
        const bc = bucket.config as import('../model').S3Config;
        if (!d.config.oac) return { status: 'fail', message: `${d.name} does not use Origin Access Control, so ${bucket.name} would have to be public for it to work.`, highlight: [d.id], fixTarget: d.id };
        if (bc.policy !== 'cloudfront-oac' || bc.policyDistributionId !== d.id) return { status: 'fail', message: `${bucket.name}'s bucket policy doesn't restrict reads to ${d.name} (cloudfront.amazonaws.com with AWS:SourceArn).`, highlight: [bucket.id], fixTarget: bucket.id };
      }
      return { status: 'pass', message: 'Buckets only grant reads to their CloudFront distribution via OAC.', highlight: [] };
    },
  },
  httpsOnly: {
    id: 'httpsOnly',
    title: 'Viewers connect over HTTPS',
    concept: 'cloudfront-edge',
    check: (b) => {
      const dists = componentsOfType(b, 'cloudfront');
      const albs = componentsOfType(b, 'alb').filter((a) => a.config.scheme === 'internet-facing');
      if (!dists.length && !albs.length) return na('No viewer-facing entry point.');
      const d = dists.find((x) => x.config.viewerProtocol === 'allow-all');
      if (d) return { status: 'fail', message: `${d.name} allows plain HTTP. Use redirect-to-https or https-only.`, highlight: [d.id], fixTarget: d.id };
      const a = albs.find((x) => x.config.listener.protocol !== 'HTTPS');
      if (a) return { status: 'fail', message: `${a.name}'s listener is plain HTTP.`, highlight: [a.id], fixTarget: a.id };
      return { status: 'pass', message: 'Viewers are always on HTTPS.', highlight: [] };
    },
  },
};

export function runAudit(board: Board, ruleIds: string[]): { rule: AuditRule; finding: AuditFinding }[] {
  return ruleIds.map((id) => {
    const rule = AUDIT_RULES[id];
    if (!rule) throw new Error(`Unknown audit rule ${id}`);
    return { rule, finding: rule.check(board) };
  });
}
