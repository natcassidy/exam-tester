// Region outage model: DNS failover + bringing up whatever isn't already running in the DR
// Region. RPO comes from how data reaches the DR Region. The result also names the DR strategy
// the board implements (backup and restore, pilot light, warm standby, multi-site active/active).

import type { Board, Component, ConfigOf, Trace } from '../model';
import { clone, componentsOfType, regionOf } from '../board';
import { INSTANCE_RPS_AT_70 } from '../cost/pricing';
import { detectionSec, effectiveTtl, policyOf, resolveDns } from '../net/dns';
import { regionName } from '../net/geo';
import { failingHop, traceFlow } from '../net/trace';
import { resolveRef } from '../select';
import { readyDelayMin } from './capacity';
import { rdsRestoreMinutes, type TierOutcome } from './failure';

export interface RegionOutageParams {
  region: string;
  loadRps: number;
  rtoSec: number;
  rpoSec: number;
  /** Route 53 record users resolve (a ref, default 'route53'). */
  dns?: string;
  clientCity?: string;
  /** Port the DR app tier uses to reach its database. */
  dbPort?: number;
}

export type DrStrategy = 'none' | 'backup-restore' | 'pilot-light' | 'warm-standby' | 'multi-site';

export const DR_STRATEGY_LABEL: Record<DrStrategy, string> = {
  none: 'No working DR',
  'backup-restore': 'Backup and restore',
  'pilot-light': 'Pilot light',
  'warm-standby': 'Warm standby',
  'multi-site': 'Multi-site active/active',
};

export interface RegionOutageOutcome {
  tiers: TierOutcome[];
  rtoSec: number;
  rpoSec: number;
  strategy: DrStrategy;
  strategyExplain: string;
  drRegion?: string;
  trace?: Trace;
}

/** Launch a fleet from nothing: instances, bootstrap from the AMI, register with the load balancer (plus warmup). */
export const SCALE_FROM_ZERO_BASE_SEC = 600;
export const RDS_PROMOTE_SEC = 300;
export const RDS_CROSS_REGION_LAG_SEC = 60;
export const AURORA_GLOBAL_PROMOTE_SEC = 60;
export const AURORA_GLOBAL_RPO_SEC = 1;
export const DDB_GLOBAL_RPO_SEC = 1;
export const DDB_RESTORE_MIN = 30;
const UTIL_LIMIT = 0.9;

type DataMode = 'live' | 'backup' | 'none';

function neededInstances(asg: ConfigOf<'asg'>, loadRps: number): number {
  return Math.ceil(loadRps / ((INSTANCE_RPS_AT_70[asg.instanceType] / 0.7) * UTIL_LIMIT));
}

function backupFor(board: Board, store: Component, failed: string): ConfigOf<'backup'> | undefined {
  return componentsOfType(board, 'backup').find((b) => b.config.resourceIds.includes(store.id) && b.config.copyRegion && b.config.copyRegion !== failed)?.config;
}

/** How a data store in the failed Region recovers. */
function dataTier(board: Board, store: Component, failed: string): TierOutcome & { mode: DataMode } {
  const cfg = store.config;
  const backup = backupFor(board, store, failed);
  const fromBackup = (restoreSec: number, what: string): TierOutcome & { mode: DataMode } => ({
    tier: 'Data',
    componentId: store.id,
    rtoSec: restoreSec,
    rpoSec: backup!.frequencyHours * 3600,
    status: 'warn',
    mode: 'backup',
    explain: `${store.name}: AWS Backup copies a recovery point to ${backup!.copyRegion} every ${backup!.frequencyHours} h. Recovery is a ${what} (~${Math.round(restoreSec / 60)} min), and everything written since the last copy is lost (RPO up to ${backup!.frequencyHours} h).`,
  });
  const lost = (extra = ''): TierOutcome & { mode: DataMode } => ({
    tier: 'Data',
    componentId: store.id,
    rtoSec: Infinity,
    rpoSec: Infinity,
    status: 'fail',
    mode: 'none',
    explain: `${store.name} only exists in ${failed}. Nothing replicates or copies it to another Region, so the data is unavailable until the Region recovers, or gone.${extra}`,
  });

  if (cfg.type === 'rds') {
    const replica = componentsOfType(board, 'rds').find((r) => r.config.replicaOf === store.id && regionOf(board, r) !== failed);
    if (replica)
      return { tier: 'Data', componentId: replica.id, rtoSec: RDS_PROMOTE_SEC, rpoSec: RDS_CROSS_REGION_LAG_SEC, status: 'pass', mode: 'live', explain: `${replica.name} is a cross-Region read replica in ${regionOf(board, replica)}. Promoting it to a standalone primary takes several minutes (modelled ${RDS_PROMOTE_SEC / 60} min). Replication is asynchronous, so the last seconds of writes can be lost (modelled ${RDS_CROSS_REGION_LAG_SEC}s of lag).` };
    if (backup) return fromBackup(rdsRestoreMinutes(cfg) * 60, `restore of the copied snapshot to a new instance`);
    return lost(cfg.multiAz ? ' Multi-AZ protects against losing an AZ, not a Region.' : '');
  }
  if (cfg.type === 'aurora') {
    const secondary = componentsOfType(board, 'aurora').find((r) => r.config.globalPrimaryId === store.id && regionOf(board, r) !== failed);
    if (secondary)
      return { tier: 'Data', componentId: secondary.id, rtoSec: AURORA_GLOBAL_PROMOTE_SEC, rpoSec: AURORA_GLOBAL_RPO_SEC, status: 'pass', mode: 'live', explain: `${secondary.name} is an Aurora Global Database secondary in ${regionOf(board, secondary)}. Storage-level replication typically lags under a second; promoting the secondary takes about a minute.` };
    if (backup) return fromBackup(40 * 60, 'restore of the copied cluster snapshot');
    return lost(cfg.readers ? ' Aurora Replicas live in the same Region: they protect against an AZ, not a Region.' : '');
  }
  if (cfg.type === 'dynamodb') {
    const survivor = (cfg.replicaRegions ?? []).find((r) => r !== failed);
    if (regionOf(board, store) !== failed) return { tier: 'Data', componentId: store.id, rtoSec: 0, rpoSec: 0, status: 'pass', mode: 'live', explain: `${store.name} lives outside ${failed}.` };
    if (survivor)
      return { tier: 'Data', componentId: store.id, rtoSec: 0, rpoSec: DDB_GLOBAL_RPO_SEC, status: 'pass', mode: 'live', explain: `${store.name} is a global table with a replica in ${survivor}. Every replica already accepts reads and writes, so there is nothing to promote; replication typically lags about a second.` };
    if (backup) return fromBackup(DDB_RESTORE_MIN * 60, 'restore of the copied table backup');
    return lost(cfg.pitr ? ' Point-in-time recovery protects against bad writes, but its backups live in the same Region.' : '');
  }
  return lost();
}

export function computeRegionOutage(board: Board, p: RegionOutageParams): RegionOutageOutcome {
  const tiers: TierOutcome[] = [];
  const failed = p.region;
  const city = p.clientCity ?? 'virginia';
  const finish = (strategy: DrStrategy, strategyExplain: string, extra: Partial<RegionOutageOutcome> = {}): RegionOutageOutcome => ({
    tiers,
    rtoSec: Math.max(0, ...tiers.map((t) => t.rtoSec)),
    rpoSec: Math.max(0, ...tiers.map((t) => t.rpoSec)),
    strategy,
    strategyExplain,
    ...extra,
  });

  // ----- Data in the failed Region -----
  const stores = Object.values(board.components).filter(
    (c) =>
      regionOf(board, c) === failed &&
      ((c.config.type === 'rds' && !c.config.replicaOf) || (c.config.type === 'aurora' && !c.config.globalPrimaryId) || c.config.type === 'dynamodb'),
  );
  const data = stores.map((s) => dataTier(board, s, failed));
  const dataReady = Math.max(0, ...data.map((d) => d.rtoSec));
  const modes = data.map((d) => d.mode);

  // ----- DNS -----
  const dns = resolveRef(board, p.dns ?? 'route53');
  let drRegion: string | undefined;
  let computeMode: 'full' | 'scaled-down' | 'off' = 'off';
  let computeExplain = '';
  let computeReady = 0;
  let trace: Trace | undefined;
  let active = false;

  if (!dns || dns.config.type !== 'route53') {
    tiers.push({ tier: 'DNS', rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: 'There is no Route 53 record in front of the application, so users keep going to the dead Region. Something has to move them.' });
  } else {
    const cfg = dns.config;
    const policy = policyOf(cfg);
    active = !['simple', 'failover'].includes(policy);
    const before = resolveDns(board, cfg, city, []);
    const after = resolveDns(board, cfg, city, [failed]);
    const target = after.targetId ? board.components[after.targetId] : undefined;
    const tRegion = target ? regionOf(board, target) : undefined;
    const wasHere = before.targetId ? regionOf(board, board.components[before.targetId]) === failed : true;
    if (!target) {
      tiers.push({ tier: 'DNS', componentId: dns.id, rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: after.explain });
    } else if (tRegion === failed) {
      const why = policy === 'simple' ? `Simple routing has no health checks: ${cfg.recordName} keeps pointing at ${target.name} until someone edits the record by hand.` : `${after.explain} Without a health check (or Evaluate Target Health on the alias), Route 53 never notices the Region is down.`;
      tiers.push({ tier: 'DNS', componentId: dns.id, rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: why });
    } else {
      drRegion = tRegion;
      const detect = wasHere ? detectionSec(cfg) : 0;
      const ttl = wasHere ? effectiveTtl(cfg) : 0;
      tiers.push({
        tier: 'DNS',
        componentId: dns.id,
        rtoSec: detect + ttl,
        rpoSec: 0,
        status: 'pass',
        explain: wasHere
          ? `Route 53 health checks fail after ${cfg.healthCheck?.intervalSec ?? 30}s × ${cfg.healthCheck?.failureThreshold ?? 3} = ${detect}s, then resolvers keep the old answer for up to the TTL (${ttl}s${cfg.alias === false ? '' : ', the alias target\'s TTL'}). ${after.explain}`
          : `Clients near ${city} were already served from ${tRegion}. ${after.explain}`,
      });

      // ----- DR entry and compute -----
      const scaled = clone(board);
      let asg: Component | undefined;
      if (target.config.type === 'alb' && target.config.targetId) asg = scaled.components[target.config.targetId];
      if (asg?.config.type === 'asg') {
        const a = asg.config;
        const needed = neededInstances(a, p.loadRps);
        if (a.max < needed) {
          tiers.push({ tier: 'Compute', componentId: asg.id, rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: `${asg.name} in ${tRegion} needs ${needed} × ${a.instanceType} to carry ${p.loadRps} rps, but its maximum is ${a.max}.` });
          computeMode = a.desired === 0 ? 'off' : 'scaled-down';
        } else {
          if (a.desired >= needed) {
            computeMode = 'full';
            computeReady = 0;
            computeExplain = `${asg.name} already runs ${a.desired} instance(s) in ${tRegion}, enough for ${p.loadRps} rps.`;
          } else if (a.desired > 0) {
            computeMode = 'scaled-down';
            computeReady = readyDelayMin(a) * 60;
            computeExplain = `${asg.name} runs ${a.desired} of the ${needed} instances needed. It serves at reduced capacity at once and scales out within ~${Math.round(computeReady / 60)} min (launch + boot + ${a.warmupSec}s warmup).`;
          } else {
            computeMode = 'off';
            computeReady = SCALE_FROM_ZERO_BASE_SEC + a.warmupSec;
            computeExplain = `${asg.name} is scaled to zero. Launching ${needed} instances from nothing (start the fleet, bootstrap from the AMI, register with the load balancer, ${a.warmupSec}s warmup) takes ~${Math.round(computeReady / 60)} min.`;
          }
          a.desired = Math.max(a.desired, Math.min(needed, a.max));
          tiers.push({ tier: 'Compute', componentId: asg.id, rtoSec: computeReady, rpoSec: 0, status: computeMode === 'full' ? 'pass' : 'warn', explain: computeExplain });
        }
      } else if (['apigw', 'lambda', 'cloudfront', 's3'].includes(target.type)) {
        computeMode = 'full';
        tiers.push({ tier: 'Compute', componentId: target.id, rtoSec: 0, rpoSec: 0, status: 'pass', explain: `${target.name} is serverless: it scales with requests in ${tRegion}, nothing to start.` });
      } else if (target.config.type === 'alb' && target.config.targetId && scaled.components[target.config.targetId]?.type === 'ec2') {
        computeMode = 'full';
        tiers.push({ tier: 'Compute', componentId: target.config.targetId, rtoSec: 0, rpoSec: 0, status: 'pass', explain: `An instance is already running behind ${target.name}.` });
      } else {
        tiers.push({ tier: 'Compute', componentId: target.id, rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: `${target.name} in ${tRegion} has nothing behind it to serve requests.` });
      }

      // The DR path has to actually work: internet → entry → app tier, and app tier → database.
      trace = traceFlow(scaled, { from: 'internet', to: dns.id, protocol: 'tcp', port: 443, clientCity: city }, { failedRegions: [failed] });
      if (trace.result === 'dropped') {
        const bad = failingHop(trace);
        tiers.push({ tier: 'DR path', componentId: bad?.at.kind === 'component' ? bad.at.id : target.id, rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: `Users can't reach the application in ${tRegion}: ${bad?.explain ?? 'the request was dropped.'}` });
      }
      const drDb = Object.values(scaled.components).find((c) => regionOf(scaled, c) === tRegion && (c.type === 'rds' || c.type === 'aurora'));
      if (asg && drDb && trace.result === 'delivered') {
        const port = p.dbPort ?? (drDb.config as ConfigOf<'rds'>).port;
        const t = traceFlow(scaled, { from: asg.id, to: drDb.id, protocol: 'tcp', port }, { failedRegions: [failed] });
        if (t.result === 'dropped') {
          const bad = failingHop(t);
          tiers.push({ tier: 'DR path', componentId: drDb.id, rtoSec: Infinity, rpoSec: 0, status: 'fail', explain: `The DR app tier can't reach ${drDb.name} on port ${port}: ${bad?.explain ?? 'dropped.'}` });
        }
      }
    }
  }

  // Data recovery runs in parallel with compute; DNS has to flip first.
  const dnsTier = tiers.find((t) => t.tier === 'DNS');
  const recoverSec = (dnsTier?.rtoSec ?? 0) + Math.max(dataReady, computeReady);
  for (const d of data) tiers.push(d);
  if (!stores.length) tiers.push({ tier: 'Data', rtoSec: 0, rpoSec: 0, status: 'info', explain: `No database lives in ${failed}.` });

  let strategy: DrStrategy;
  let why: string;
  if (modes.includes('none') || !drRegion) {
    strategy = 'none';
    why = drRegion ? 'Some data has no copy outside the failed Region.' : 'Nothing sends users to another Region.';
  } else if (modes.includes('backup')) {
    strategy = 'backup-restore';
    why = 'Data reaches the DR Region only as backups; the database must be restored before anything can serve.';
  } else if (computeMode === 'off') {
    strategy = 'pilot-light';
    why = 'Data replicates continuously to the DR Region, but the application tier is switched off until a disaster.';
  } else if (computeMode === 'scaled-down' || !active) {
    strategy = 'warm-standby';
    why = computeMode === 'scaled-down' ? 'A scaled-down copy of the full stack runs in the DR Region and scales out on failover.' : 'A full-size copy runs in the DR Region but only receives traffic after failover (a hot standby).';
  } else {
    strategy = 'multi-site';
    why = 'Both Regions run full capacity and serve users at the same time.';
  }

  const out = finish(strategy, why, { drRegion, trace });
  // RTO is DNS + the slowest of data and compute, not the sum of every tier.
  out.rtoSec = Math.max(recoverSec, ...tiers.filter((t) => !Number.isFinite(t.rtoSec)).map((t) => t.rtoSec));
  return out;
}

export function strategyRank(s: DrStrategy): number {
  return ['none', 'backup-restore', 'pilot-light', 'warm-standby', 'multi-site'].indexOf(s);
}

export { regionName };
