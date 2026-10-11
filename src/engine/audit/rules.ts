// Reusable audit checks. Each returns 'na' when the board has nothing the rule applies to.

import type { Board, Component, ComponentId, ConceptId, FixFocus, FixPointer, S3Config, SgRule } from '../model';
import { componentsOfType, subnetsOf } from '../board';
import { isPublicSubnet } from '../net/routing';
import { fromWorld, sgOwners, sgPorts } from '../net/sg';

export interface AuditFinding {
  status: 'pass' | 'fail' | 'na';
  /** What is on the board. For a failure: what is wrong and what it should be instead. */
  message: string;
  highlight: ComponentId[];
  /** Set on every failure: the object to open, what to change there, and where. */
  fix?: FixPointer;
}

export interface AuditRule {
  id: string;
  title: string;
  concept: ConceptId;
  /** Why the rule matters, in one or two sentences (shown as the lesson). */
  why: string;
  check: (board: Board) => AuditFinding;
}

const na = (message: string): AuditFinding => ({ status: 'na', message, highlight: [] });
const pass = (message: string): AuditFinding => ({ status: 'pass', message, highlight: [] });
const fail = (message: string, highlight: ComponentId[], fix: FixPointer): AuditFinding => ({ status: 'fail', message, highlight, fix });

const CONFIG = (label: string): FixFocus => ({ tab: 'config', label });
const NETWORKING = (label: string): FixFocus => ({ tab: 'networking', label });

const covers = (r: SgRule, p: number) => r.protocol === 'all' || (r.protocol === 'tcp' && r.fromPort <= p && r.toPort >= p);
const isWorld = fromWorld;
const ruleRef = (dir: 'inbound' | 'outbound', i: number) => `${dir} rule #${i + 1}`;

/** The security group a tier should accept traffic from: the load balancer's for app servers, the app tier's for databases. */
function frontSgName(b: Board, c: Component): string | null {
  const front = c.type === 'rds' || c.type === 'aurora' ? ['asg', 'ec2', 'lambda'] : ['alb'];
  const owner = Object.values(b.components).find((o) => front.includes(o.type) && o.securityGroupIds?.length && o.id !== c.id);
  return owner ? b.securityGroups[owner.securityGroupIds![0]]?.name ?? null : null;
}

export const AUDIT_RULES: Record<string, AuditRule> = {
  dbNotPublic: {
    id: 'dbNotPublic',
    title: 'Databases are not publicly accessible',
    concept: 'vpc-public-private',
    why: 'A database with a public IP or a public subnet is one security group mistake away from the internet. Keep it private and reach it only from the app tier.',
    check: (b) => {
      const dbs = componentsOfType(b, 'rds');
      if (!dbs.length) return na('No RDS database on the board.');
      for (const db of dbs) {
        if (db.config.publiclyAccessible)
          return fail(`${db.name} has "Publicly accessible" set to Yes, so it gets a public IP address. It should be No.`, [db.id], {
            target: db.id,
            hint: `Open ${db.name} and set "Publicly accessible" to No.`,
            focus: CONFIG('Publicly accessible'),
          });
        const pub = subnetsOf(db).filter((s) => isPublicSubnet(b, s));
        if (pub.length)
          return fail(`${db.name}'s subnet group includes public subnet${pub.length > 1 ? 's' : ''} (${pub.join(', ')}). It should only use private (data) subnets.`, [db.id], {
            target: db.id,
            hint: `On ${db.name}'s Networking tab, untick ${pub.join(' and ')} in the DB subnet group and tick the private data subnets instead.`,
            focus: NETWORKING('DB subnet group'),
          });
      }
      return pass('Every database is private: not publicly accessible and only in private subnets.');
    },
  },
  noSshFromWorld: {
    id: 'noSshFromWorld',
    title: 'No SSH/RDP open to the world',
    concept: 'security-groups',
    why: 'Admin ports open to 0.0.0.0/0 are scanned within minutes of going live. Use Systems Manager Session Manager, which needs no inbound port at all.',
    check: (b) => {
      const sgs = Object.values(b.securityGroups);
      if (!sgs.length) return na('No security groups on the board.');
      for (const sg of sgs)
        for (const [i, r] of sg.inbound.entries()) {
          if (!isWorld(r) || !(covers(r, 22) || covers(r, 3389))) continue;
          const port = covers(r, 22) ? 'SSH (22)' : 'RDP (3389)';
          const owner = Object.values(b.components).find((c) => c.securityGroupIds?.includes(sg.id));
          return fail(`${sg.name}${owner ? ` (on ${owner.name})` : ''} allows ${port} from 0.0.0.0/0 (inbound rule #${i + 1}). No rule should open admin ports to the world.`, owner ? [owner.id] : [], {
            target: sg.id,
            hint: `Delete inbound rule #${i + 1} from ${sg.name}${r.protocol === 'all' ? ' and allow only the ports the tier serves, from the security group in front of it' : ''}. Use Session Manager for shell access instead.`,
            ruleRef: ruleRef('inbound', i),
          });
        }
      return pass('No security group exposes SSH or RDP to 0.0.0.0/0.');
    },
  },
  appTierPrivate: {
    id: 'appTierPrivate',
    title: 'App servers are in private subnets',
    concept: 'vpc-public-private',
    why: 'App servers only need to be reached by the load balancer. Private subnets and no public IPs mean nothing on the internet can connect to them directly.',
    check: (b) => {
      const apps = [...componentsOfType(b, 'asg'), ...componentsOfType(b, 'ec2')];
      if (!apps.length) return na('No EC2 instances or Auto Scaling groups on the board.');
      for (const a of apps) {
        if (a.config.publicIp)
          return fail(`${a.name} gives its instances public IP addresses. App servers should have private addresses only and sit behind the load balancer.`, [a.id], {
            target: a.id,
            hint: `Open ${a.name} and turn off "Auto-assign public IPv4".`,
            focus: CONFIG('Auto-assign public IPv4'),
          });
        const pub = subnetsOf(a).filter((s) => isPublicSubnet(b, s));
        if (pub.length)
          return fail(`${a.name} runs in public subnet${pub.length > 1 ? 's' : ''} (${pub.join(', ')}). It should run in the private app subnets.`, [a.id], {
            target: a.id,
            hint: `On ${a.name}'s Networking tab, untick ${pub.join(' and ')} and tick the private app subnets in each AZ.`,
            focus: NETWORKING('Subnets'),
          });
      }
      return pass('App servers run in private subnets with no public IPs.');
    },
  },
  privateTierSgsChained: {
    id: 'privateTierSgsChained',
    title: 'Private tiers only accept traffic from the tier in front',
    concept: 'sg-chaining',
    why: 'Chaining security groups (ALB SG → app SG → DB SG) means each tier accepts traffic only from the tier in front of it, whatever IP addresses those instances get as they scale.',
    check: (b) => {
      const comps = [...componentsOfType(b, 'asg'), ...componentsOfType(b, 'ec2'), ...componentsOfType(b, 'rds')];
      if (!comps.length) return na('No private-tier components on the board.');
      for (const c of comps)
        for (const sgId of c.securityGroupIds ?? []) {
          const sg = b.securityGroups[sgId];
          const i = sg?.inbound.findIndex(isWorld) ?? -1;
          if (!sg || i < 0) continue;
          // The load balancer's SG is meant to be open; the mistake is attaching it to the private tier.
          const lb = sgOwners(b, sgId).find((o) => o.type === 'alb');
          if (lb) {
            const own = (c.securityGroupIds ?? []).filter((x) => x !== sgId).map((x) => b.securityGroups[x]?.name).filter(Boolean);
            return fail(`${c.name} has the load balancer's security group (${sg.name}) attached, and ${sg.name} allows inbound from 0.0.0.0/0. ${c.name} should carry only its own group${own.length ? ` (${own.join(', ')})` : ''}, and that group should allow traffic from ${sg.name}.`, [c.id], {
              target: c.id,
              hint: `On ${c.name}'s Networking tab, untick ${sg.name} under "Security groups attached".${own.length ? ` Keep ${own.join(', ')} and check it has an inbound rule whose source is ${sg.name}.` : ` Create a group for ${c.name} that allows traffic from ${sg.name}.`}`,
              focus: NETWORKING('Security groups attached'),
            });
          }
          const front = frontSgName(b, c);
          const ports = sgPorts(sg.inbound[i]);
          return fail(`${sg.name} (on ${c.name}) allows ${ports} from 0.0.0.0/0 (inbound rule #${i + 1}). The source should be ${front ? `the security group in front of it, ${front}` : 'the security group of the tier in front of it'}, not an address range.`, [c.id], {
            target: sg.id,
            hint: `In ${sg.name}, delete inbound rule #${i + 1} and add the same port with source type "Security group" and ${front ? `source ${front}` : 'the front tier\'s group as the source'}.`,
            ruleRef: ruleRef('inbound', i),
          });
        }
      return pass('App and data tiers only accept traffic from the security group in front of them.');
    },
  },
  dbSgLeastPrivilege: {
    id: 'dbSgLeastPrivilege',
    title: 'Only the app tier can reach the database',
    concept: 'sg-chaining',
    why: "A database should trust one thing: the app tier's security group. A CIDR or the load balancer's group lets more than the app in.",
    check: (b) => {
      const dbs = componentsOfType(b, 'rds');
      if (!dbs.length) return na('No RDS database on the board.');
      const appSgs = new Set(Object.values(b.components).filter((c) => ['asg', 'ec2', 'lambda'].includes(c.type)).flatMap((c) => c.securityGroupIds ?? []));
      const appSgName = [...appSgs].map((id) => b.securityGroups[id]?.name).find(Boolean);
      for (const db of dbs)
        for (const sgId of db.securityGroupIds ?? []) {
          const sg = b.securityGroups[sgId];
          for (const [i, r] of (sg?.inbound ?? []).entries()) {
            if ('sg' in r.source && appSgs.has(r.source.sg)) continue;
            const src = 'cidr' in r.source ? r.source.cidr : 'sg' in r.source ? b.securityGroups[r.source.sg]?.name ?? r.source.sg : r.source.prefixList;
            return fail(`${sg.name} (on ${db.name}) accepts traffic from ${src} (inbound rule #${i + 1}). Its only source should be the app tier's security group${appSgName ? `, ${appSgName}` : ''}.`, [db.id], {
              target: sg.id,
              hint: `In ${sg.name}, ${appSgName ? `change inbound rule #${i + 1} so its source is the security group ${appSgName}` : `delete inbound rule #${i + 1} and allow the database port from the app tier's security group`}.`,
              ruleRef: ruleRef('inbound', i),
            });
          }
        }
      return pass('Database security groups only reference the app tier security group.');
    },
  },
  s3BlockPublicAccess: {
    id: 's3BlockPublicAccess',
    title: 'S3 Block Public Access is on',
    concept: 's3-block-public-access',
    why: 'Block Public Access overrides any bucket policy or ACL that would make objects public, so one wrong policy cannot leak the data.',
    check: (b) => {
      const buckets = componentsOfType(b, 's3');
      if (!buckets.length) return na('No S3 bucket on the board.');
      const off = buckets.find((x) => !x.config.blockPublicAccess);
      if (off) return fail(`${off.name} has Block Public Access turned off. It should be on.`, [off.id], { target: off.id, hint: `Open ${off.name} and turn on "Block Public Access (all four)".`, focus: CONFIG('Block Public Access') });
      return pass('Block Public Access is on for every bucket.');
    },
  },
  encryptionAtRest: {
    id: 'encryptionAtRest',
    title: 'Data is encrypted at rest',
    concept: 'encryption-at-rest',
    why: 'Encryption at rest protects data on disks, snapshots and backups. For RDS it must be chosen when the database is created.',
    check: (b) => {
      const dbs = componentsOfType(b, 'rds');
      const qs = componentsOfType(b, 'sqs');
      const buckets = componentsOfType(b, 's3');
      const tables = componentsOfType(b, 'dynamodb');
      if (!dbs.length && !qs.length && !buckets.length && !tables.length) return na('No data stores on the board.');
      const db = dbs.find((d) => !d.config.storageEncrypted);
      if (db)
        return fail(`${db.name}'s storage is not encrypted. It should be. (In AWS you pick this at creation; to fix an existing database you restore an encrypted copy of a snapshot.)`, [db.id], {
          target: db.id,
          hint: `Open ${db.name} and turn on "Storage encrypted".`,
          focus: CONFIG('Storage encrypted'),
        });
      const q = qs.find((x) => !x.config.sse);
      if (q) return fail(`${q.name} has server-side encryption turned off. It should be on.`, [q.id], { target: q.id, hint: `Open ${q.name} and turn on "Server-side encryption".`, focus: CONFIG('Server-side encryption') });
      return pass('All data stores encrypt at rest (S3 and DynamoDB always encrypt new data by default).');
    },
  },
  s3CustomerManagedKey: {
    id: 's3CustomerManagedKey',
    title: 'Regulated buckets use the customer managed KMS key',
    concept: 'kms-key-policies',
    why: 'A customer managed key gives the company control: its own key policy, rotation, and a CloudTrail record of every use. SSE-S3 and the AWS managed key do not.',
    check: (b) => {
      const buckets = componentsOfType(b, 's3');
      if (!buckets.length) return na('No S3 bucket on the board.');
      const off = buckets.find((x) => x.config.encryption !== 'SSE-KMS' || !x.config.kmsKeyId);
      if (off)
        return fail(`${off.name} is encrypted with ${off.config.encryption === 'SSE-KMS' ? 'SSE-KMS but no customer managed key' : off.config.encryption}. It should use SSE-KMS with the customer managed key.`, [off.id], {
          target: off.id,
          hint: `Open ${off.name}, set "Default encryption" to SSE-KMS and pick the customer managed key.`,
          focus: CONFIG('Default encryption'),
        });
      return pass('Every bucket uses SSE-KMS with a customer managed key.');
    },
  },
  wafOnPublicEntry: {
    id: 'wafOnPublicEntry',
    title: 'Public entry points are protected by AWS WAF',
    concept: 'aws-waf',
    why: 'Security groups only filter ports and addresses. AWS WAF inspects the HTTP requests themselves: SQL injection, cross-site scripting, bad bots and request floods.',
    check: (b) => {
      const entries = [...componentsOfType(b, 'alb').filter((a) => a.config.scheme === 'internet-facing'), ...componentsOfType(b, 'cloudfront')];
      if (!entries.length) return na('No internet-facing entry point on the board.');
      const wafs = componentsOfType(b, 'waf');
      const unprotected = entries.find((e) => !wafs.some((w) => w.config.associatedId === e.id));
      if (unprotected) {
        const free = wafs.find((w) => !w.config.associatedId || !b.components[w.config.associatedId]);
        const waf = free ?? wafs[0];
        return fail(`${unprotected.name} faces the internet with no WAF web ACL associated. ${waf ? `${waf.name} is ${waf.config.associatedId && b.components[waf.config.associatedId] ? `associated with ${b.components[waf.config.associatedId].name}` : 'not associated with anything'}.` : 'There is no web ACL on the board.'}`, [unprotected.id], waf
          ? { target: waf.id, hint: `Open ${waf.name} and set "Associated resource" to ${unprotected.name}${free ? '' : ', or drag a second AWS WAF web ACL into the Global edge for it'}.`, focus: CONFIG('Associated resource') }
          : { target: unprotected.id, hint: `Drag AWS WAF from the palette into the Global edge zone, then set its "Associated resource" to ${unprotected.name}.` });
      }
      return pass('Every public entry point has a WAF web ACL associated.');
    },
  },
  s3OriginAccessControl: {
    id: 's3OriginAccessControl',
    title: 'S3 origins are only reachable through CloudFront (OAC)',
    concept: 'cloudfront-oac',
    why: 'With Origin Access Control the bucket stays private and only the distribution can read it, so nobody can bypass CloudFront (and its caching, WAF and HTTPS).',
    check: (b) => {
      const dists = componentsOfType(b, 'cloudfront').filter((d) => d.config.originId && b.components[d.config.originId]?.type === 's3');
      if (!dists.length) return na('No CloudFront distribution with an S3 origin.');
      for (const d of dists) {
        const bucket = b.components[d.config.originId!];
        const bc = bucket.config as S3Config;
        if (!d.config.oac)
          return fail(`${d.name} does not use Origin Access Control, so ${bucket.name} would have to be public for it to work. It should sign its requests with OAC.`, [d.id], {
            target: d.id,
            hint: `Open ${d.name} and turn on "Origin Access Control (OAC)".`,
            focus: CONFIG('Origin Access Control'),
          });
        if (bc.policy !== 'cloudfront-oac' || bc.policyDistributionId !== d.id)
          return fail(`${bucket.name}'s bucket policy doesn't limit reads to ${d.name}. It should allow only cloudfront.amazonaws.com with AWS:SourceArn = ${d.name}.`, [bucket.id], {
            target: bucket.id,
            hint: `Open ${bucket.name}, set "Bucket policy" to CloudFront OAC only and pick ${d.name} as the distribution.`,
            focus: CONFIG('Bucket policy'),
          });
      }
      return pass('Buckets only grant reads to their CloudFront distribution via OAC.');
    },
  },
  httpsOnly: {
    id: 'httpsOnly',
    title: 'Viewers connect over HTTPS',
    concept: 'cloudfront-edge',
    why: 'Plain HTTP sends cookies, passwords and data in the clear. Terminate TLS at the edge or load balancer and redirect HTTP to HTTPS.',
    check: (b) => {
      const dists = componentsOfType(b, 'cloudfront');
      const albs = componentsOfType(b, 'alb').filter((a) => a.config.scheme === 'internet-facing');
      if (!dists.length && !albs.length) return na('No viewer-facing entry point.');
      const d = dists.find((x) => x.config.viewerProtocol === 'allow-all');
      if (d) return fail(`${d.name} allows plain HTTP. It should redirect to HTTPS (or accept HTTPS only).`, [d.id], { target: d.id, hint: `Open ${d.name} and set "Viewer protocol" to Redirect HTTP to HTTPS.`, focus: CONFIG('Viewer protocol') });
      const a = albs.find((x) => x.config.listener.protocol !== 'HTTPS');
      if (a) return fail(`${a.name}'s listener is plain HTTP. It should be HTTPS on 443.`, [a.id], { target: a.id, hint: `Open ${a.name} and set "Listener protocol" to HTTPS (port 443).`, focus: CONFIG('Listener protocol') });
      return pass('Viewers are always on HTTPS.');
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
