// AZ outage model: per-tier RTO/RPO. The worst tier sets the measured values.

import type { Board, Component, ConfigOf } from '../model';
import { componentsOfType, subnetsOf } from '../board';
import { INSTANCE_RPS_AT_70 } from '../cost/pricing';
import { allSubnets, findSubnet, targetId, targetKind } from '../net/routing';
import { asgSpread } from '../net/trace';
import { readyDelayMin } from './capacity';

export interface TierOutcome {
  tier: string;
  componentId?: string;
  rtoSec: number;
  rpoSec: number;
  status: 'pass' | 'warn' | 'fail' | 'info';
  explain: string;
}

export interface AzOutageParams {
  az: string;
  loadRps: number;
  rtoSec: number;
  rpoSec: number;
  /** The workload needs outbound internet (payments API, patching) to be considered recovered. */
  requireOutbound?: boolean;
}

export interface AzOutageOutcome {
  tiers: TierOutcome[];
  rtoSec: number;
  rpoSec: number;
}

const EC2_STATUS_DETECT_SEC = 60;
const LAUNCH_SEC = 60;
const UTIL_LIMIT = 0.9; // above this, p95 latency breaks typical SLOs

export function rdsRestoreMinutes(cfg: ConfigOf<'rds'>): number {
  return Math.min(60, 30 + Math.round(cfg.allocatedStorageGb / 40));
}

export function computeAzOutage(board: Board, p: AzOutageParams): AzOutageOutcome {
  const tiers: TierOutcome[] = [];
  const azOf = (sid: string) => findSubnet(board, sid)?.subnet.azId;

  // Entry: load balancer.
  for (const alb of componentsOfType(board, 'alb')) {
    const cfg = alb.config;
    const alive = subnetsOf(alb).filter((s) => azOf(s) !== p.az);
    const detect = cfg.healthCheck.intervalSec * cfg.healthCheck.unhealthyThreshold;
    if (!alive.length) {
      tiers.push({ tier: 'Load balancer', componentId: alb.id, rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: `${alb.name} is only enabled in ${p.az}. With that AZ down there is no load balancer node to accept traffic.` });
      continue;
    }
    tiers.push({
      tier: 'Load balancer',
      componentId: alb.id,
      rtoSec: detect,
      rpoSec: 0,
      status: 'pass',
      explain: `${alb.name} keeps serving from ${alive.map(azOf).join(', ')}. Targets in ${p.az} are marked unhealthy after ${cfg.healthCheck.intervalSec}s × ${cfg.healthCheck.unhealthyThreshold} = ${detect}s; until then some requests fail.`,
    });

    const target = cfg.targetId ? board.components[cfg.targetId] : undefined;
    if (target?.config.type === 'asg') tiers.push(asgTier(board, target, p, detect));
    if (target?.config.type === 'ec2') {
      const down = azOf(target.placement.refId) === p.az;
      tiers.push({
        tier: 'Compute',
        componentId: target.id,
        rtoSec: down ? Infinity : 0,
        rpoSec: 0,
        status: down ? 'fail' : 'pass',
        explain: down ? `${target.name} is a single instance in ${p.az}. Nothing replaces it automatically.` : `${target.name} is not in ${p.az}.`,
      });
    }
  }

  // Database tier.
  // Read replicas and global secondaries don't take writes: losing one doesn't take the application down.
  for (const db of componentsOfType(board, 'rds').filter((d) => !d.config.replicaOf)) {
    const cfg = db.config;
    const primaryAz = azOf(subnetsOf(db)[0]);
    if (primaryAz !== p.az) {
      tiers.push({ tier: 'Database', componentId: db.id, rtoSec: 0, rpoSec: 0, status: 'pass', explain: `${db.name}'s primary is in ${primaryAz}, which survives.${cfg.multiAz ? ' The standby is re-created in another AZ in the background.' : ''}` });
      continue;
    }
    if (cfg.multiAz) {
      tiers.push({ tier: 'Database', componentId: db.id, rtoSec: 90, rpoSec: 0, status: 'pass', explain: `Multi-AZ failover: RDS promotes the synchronous standby and flips the endpoint's DNS record. Typically 60-120s (modelled as 90s). RPO is 0 because every commit was already written to the standby.` });
    } else if (cfg.backupRetentionDays > 0) {
      const mins = rdsRestoreMinutes(cfg);
      tiers.push({
        tier: 'Database',
        componentId: db.id,
        rtoSec: mins * 60,
        rpoSec: 300,
        status: 'fail',
        explain: `Single-AZ: the only copy of ${db.name} is in the failed AZ. Recovery is a point-in-time restore to a new instance (~${mins} min for ${cfg.allocatedStorageGb} GB). Transaction logs ship to S3 every 5 minutes, so up to 5 minutes of writes are lost.${cfg.readReplicas ? ' A read replica could be promoted manually, but replication is asynchronous and promotion is not automatic.' : ''}`,
      });
    } else {
      tiers.push({ tier: 'Database', componentId: db.id, rtoSec: Infinity, rpoSec: Infinity, status: 'fail', explain: `Single-AZ with backup retention 0: there are no automated backups. Total data loss.` });
    }
  }

  for (const db of componentsOfType(board, 'aurora').filter((d) => !d.config.globalPrimaryId)) {
    const primaryAz = azOf(subnetsOf(db)[0]);
    if (primaryAz !== p.az) {
      tiers.push({ tier: 'Database', componentId: db.id, rtoSec: 0, rpoSec: 0, status: 'pass', explain: `${db.name}'s writer is in ${primaryAz}, which survives.` });
      continue;
    }
    if (db.config.readers > 0)
      tiers.push({ tier: 'Database', componentId: db.id, rtoSec: 30, rpoSec: 0, status: 'pass', explain: `Aurora promotes a reader in another AZ to writer, typically in about 30 seconds. RPO is 0: the cluster volume keeps six copies across three AZs.` });
    else
      tiers.push({ tier: 'Database', componentId: db.id, rtoSec: 600, rpoSec: 0, status: 'warn', explain: `No Aurora Replica to promote, so Aurora creates a new writer instance in another AZ (up to ~10 minutes). No data is lost: storage is replicated six ways across three AZs.` });
  }

  // NAT dependency.
  const deadNats = componentsOfType(board, 'nat').filter((n) => azOf(n.placement.refId) === p.az);
  const stranded = allSubnets(board).filter((s) => {
    if (s.azId === p.az || !s.components.length) return false;
    const rt = board.routeTables[s.routeTableId];
    const def = rt?.routes.find((r) => r.dest === '0.0.0.0/0');
    return def && targetKind(def.target) === 'nat' && deadNats.some((n) => n.id === targetId(def.target));
  });
  if (stranded.length) {
    tiers.push({
      tier: 'Outbound (NAT)',
      componentId: deadNats[0].id,
      rtoSec: p.requireOutbound ? Infinity : 0,
      rpoSec: 0,
      status: p.requireOutbound ? 'fail' : 'warn',
      explain: `${stranded.map((s) => s.name).join(', ')} still route 0.0.0.0/0 to ${deadNats[0].name} in the failed AZ. NAT gateways are AZ-scoped, so those instances lose outbound internet access until someone edits the route table. Use one NAT gateway per AZ.`,
    });
  } else if (componentsOfType(board, 'nat').length) {
    tiers.push({ tier: 'Outbound (NAT)', rtoSec: 0, rpoSec: 0, status: 'pass', explain: 'Every surviving private subnet routes through a NAT gateway in its own AZ.' });
  }

  // Regional services are unaffected by a single AZ.
  const regional = Object.values(board.components).filter((c) => ['s3', 'sqs', 'lambda', 'apigw', 'dynamodb', 'kinesis', 'firehose', 'athena', 'backup', 'tgw'].includes(c.type));
  if (regional.length) tiers.push({ tier: 'Regional services', rtoSec: 0, rpoSec: 0, status: 'info', explain: `${regional.map((c) => c.name).join(', ')} are regional services that span AZs automatically.` });

  const rtoSec = tiers.reduce((m, t) => Math.max(m, t.rtoSec), 0);
  const rpoSec = tiers.reduce((m, t) => Math.max(m, t.rpoSec), 0);
  return { tiers, rtoSec, rpoSec };
}

function asgTier(board: Board, asg: Component, p: AzOutageParams, detectSec: number): TierOutcome {
  const cfg = asg.config as ConfigOf<'asg'>;
  const spread = asgSpread(asg);
  const azOf = (sid: string) => findSubnet(board, sid)?.subnet.azId;
  const aliveSubnets = subnetsOf(asg).filter((s) => azOf(s) !== p.az);
  const lost = Object.entries(spread).filter(([s]) => azOf(s) === p.az).reduce((a, [, n]) => a + n, 0);
  const surviving = cfg.desired - lost;
  const perInstance = INSTANCE_RPS_AT_70[cfg.instanceType] / 0.7;
  const needed = Math.ceil(p.loadRps / (perInstance * UTIL_LIMIT));
  if (!aliveSubnets.length) {
    return { tier: 'Compute', componentId: asg.id, rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: `${asg.name} only has subnets in ${p.az}. It cannot launch replacements anywhere else, so the app is down until the AZ recovers.` };
  }
  if (surviving >= needed) {
    return {
      tier: 'Compute',
      componentId: asg.id,
      rtoSec: detectSec,
      rpoSec: 0,
      status: 'pass',
      explain: `Static stability: ${surviving} surviving instance(s) can carry ${p.loadRps} rps on their own (${needed} needed at ≤${UTIL_LIMIT * 100}% CPU). ${lost ? `The group relaunches the ${lost} lost instance(s) in the surviving AZ in the background.` : ''}`,
    };
  }
  if (cfg.max < needed) {
    return { tier: 'Compute', componentId: asg.id, rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: `${needed} instances are needed for ${p.loadRps} rps, but max capacity is ${cfg.max}. The app stays overloaded.` };
  }
  const detect = cfg.healthCheckType === 'ELB' ? detectSec : EC2_STATUS_DETECT_SEC;
  const rto = detect + LAUNCH_SEC + readyDelayMin(cfg) * 60 - 60;
  return {
    tier: 'Compute',
    componentId: asg.id,
    rtoSec: rto,
    rpoSec: 0,
    status: 'warn',
    explain: `Only ${surviving} instance(s) survive but ${needed} are needed for ${p.loadRps} rps, so the app is overloaded until replacements are in service: ${detect}s detection + ${LAUNCH_SEC}s launch + ${cfg.warmupSec}s warmup = ${rto}s. A design sized at exactly 100% across two AZs fails during an outage. Over-provision so one AZ can carry the load (static stability).`,
  };
}
