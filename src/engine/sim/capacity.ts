// Per-minute capacity model. Deterministic: no randomness.

import type { AsgConfig, Board, Component, ConfigOf, LambdaConfig, TimelinePoint } from '../model';
import { APIGW_INTEGRATION_TIMEOUT_SEC, AURORA_CAPACITY, AURORA_QPS_PER_ACU, DB_CAPACITY, INSTANCE_RPS_AT_70, LAMBDA_ACCOUNT_CONCURRENCY } from '../cost/pricing';

export interface ProfilePoint {
  min: number;
  rps: number;
}

/** Piecewise-linear demand curve. */
export function demandAt(profile: ProfilePoint[], min: number): number {
  if (!profile.length) return 0;
  if (min <= profile[0].min) return profile[0].rps;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if (min <= b.min) return a.rps + ((b.rps - a.rps) * (min - a.min)) / (b.min - a.min || 1);
  }
  return profile[profile.length - 1].rps;
}

/** Minutes from launch until a new instance serves traffic: ~1 min boot + the configured warmup. */
export function readyDelayMin(cfg: AsgConfig): number {
  return 1 + cfg.warmupSec / 60;
}

export function p95Latency(baseMs: number, util: number): number {
  return baseMs / (1 - Math.min(util, 0.95));
}

export interface AsgSimOptions {
  baseLatencyMs?: number;
  /** Capacity removed at a given minute (e.g. instances lost in an AZ outage). */
  loseInstancesAt?: { min: number; count: number };
}

export interface AsgSimResult {
  points: TimelinePoint[];
  marks: { min: number; label: string }[];
  totalRequests: number;
  totalErrors: number;
  maxP95: number;
  peakUtil: number;
  maxInstances: number;
}

/**
 * Simulates an Auto Scaling group minute by minute.
 * Target tracking: desired = ceil(inService × cpu / target), capped at max. Instances in warmup
 * don't contribute to the metric or to capacity but do count as already launched.
 */
export function simulateAsg(cfg: AsgConfig, profile: ProfilePoint[], durationMin: number, opts: AsgSimOptions = {}): AsgSimResult {
  const base = opts.baseLatencyMs ?? 50;
  const perInstance = INSTANCE_RPS_AT_70[cfg.instanceType] / 0.7; // rps at 100% CPU
  let instances: number[] = Array.from({ length: cfg.desired }, () => 0); // readyAt minute
  let desired = cfg.desired;
  const points: TimelinePoint[] = [];
  const marks: { min: number; label: string }[] = [];
  let totalRequests = 0;
  let totalErrors = 0;
  let maxP95 = 0;
  let peakUtil = 0;
  let maxInstances = desired;

  for (let m = 0; m < durationMin; m++) {
    if (opts.loseInstancesAt && m === opts.loseInstancesAt.min) {
      instances = instances.slice(opts.loseInstancesAt.count);
      marks.push({ min: m, label: `lost ${opts.loseInstancesAt.count} instance(s)` });
    }
    const d = demandAt(profile, m);
    const ready = instances.filter((t) => t <= m).length;
    const capMax = ready * perInstance;
    const util = capMax > 0 ? d / capMax : d > 0 ? Infinity : 0;
    const errors = Math.max(0, d - capMax);
    const p95 = ready > 0 ? p95Latency(base, util) : 0;
    totalRequests += d * 60;
    totalErrors += errors * 60;
    if (d > 0 && ready > 0) maxP95 = Math.max(maxP95, p95);
    if (d > 0 && ready === 0) maxP95 = Infinity;
    peakUtil = Math.max(peakUtil, util);
    points.push({ min: m, demand: Math.round(d), capacity: Math.round(capMax * 0.7), errors: Math.round(errors), p95: Math.round(Math.min(p95, 99999)), instances: ready });

    // Scaling decision for the next minute (1-minute metrics).
    const cpu = Math.min(util, 1) * 100;
    let next = desired;
    const p = cfg.policy;
    if (p.kind === 'targetTracking' && ready > 0 && cpu > p.targetCpu) next = Math.max(desired, Math.ceil((ready * cpu) / p.targetCpu));
    if (p.kind === 'targetTracking' && ready === 0 && d > 0) next = Math.max(desired, cfg.min, 1);
    if (p.kind === 'step' && cpu > p.upperCpu && instances.every((t) => t <= m)) next = desired + p.addInstances;
    if (p.kind === 'scheduled') for (const a of p.actions) if (a.atMin === m + 1) next = a.desired;
    // Replace lost capacity: the group keeps the desired count.
    next = Math.max(cfg.min, Math.min(cfg.max, next));
    if (p.kind !== 'targetTracking' && p.kind !== 'step' && p.kind !== 'scheduled') next = Math.max(next, desired);
    const launch = next - instances.length;
    if (launch > 0) {
      for (let i = 0; i < launch; i++) instances.push(m + readyDelayMin(cfg));
      marks.push({ min: m, label: `+${launch} launching` });
      if (next > desired && next === cfg.max && cfg.max > desired) marks.push({ min: m, label: 'at max capacity' });
    }
    desired = Math.max(desired, next);
    maxInstances = Math.max(maxInstances, instances.length);
  }
  return { points, marks, totalRequests, totalErrors, maxP95, peakUtil, maxInstances };
}

/** Database utilisation for a request rate. Read replicas take reads only. */
export function dbUtil(rds: ConfigOf<'rds'>, qps: number, readFraction: number): number {
  const cap = DB_CAPACITY[rds.instanceClass].qps;
  const primaryLoad = qps * (1 - readFraction) + (qps * readFraction) / (1 + rds.readReplicas);
  return primaryLoad / cap;
}

/** Aurora utilisation: writes on the writer; reads on the readers (reader endpoint), or the writer if there are none. */
export function auroraUtil(cfg: ConfigOf<'aurora'>, qps: number, readFraction: number): number {
  const cap = cfg.serverlessV2 ? cfg.maxAcu * AURORA_QPS_PER_ACU : AURORA_CAPACITY[cfg.instanceClass].qps;
  const reads = qps * readFraction;
  const writer = qps * (1 - readFraction) + (cfg.readers ? 0 : reads);
  const reader = cfg.readers ? reads / cfg.readers : 0;
  return Math.max(writer, reader) / cap;
}

/** Utilisation of the board's primary database (RDS or Aurora), or null if there is none. */
export function primaryDbUtil(board: Board, qps: number, readFraction: number): { util: number; id: string; label: string } | null {
  const rds = Object.values(board.components).find((c) => c.config.type === 'rds' && !c.config.replicaOf);
  if (rds && rds.config.type === 'rds') return { util: dbUtil(rds.config, qps, readFraction), id: rds.id, label: rds.config.instanceClass };
  const aur = Object.values(board.components).find((c) => c.config.type === 'aurora' && !c.config.globalPrimaryId);
  if (aur && aur.config.type === 'aurora') return { util: auroraUtil(aur.config, qps, readFraction), id: aur.id, label: aur.config.serverlessV2 ? `Aurora Serverless v2 (max ${aur.config.maxAcu} ACU)` : aur.config.instanceClass };
  return null;
}

export function lambdaLimit(board: Board, fn: Component): number {
  const cfg = fn.config as LambdaConfig;
  if (cfg.reservedConcurrency !== null) return cfg.reservedConcurrency;
  const reservedElsewhere = Object.values(board.components)
    .filter((c) => c.id !== fn.id && c.config.type === 'lambda' && c.config.reservedConcurrency !== null)
    .reduce((s, c) => s + ((c.config as LambdaConfig).reservedConcurrency ?? 0), 0);
  return LAMBDA_ACCOUNT_CONCURRENCY - reservedElsewhere;
}

export interface SyncLambdaResult {
  points: TimelinePoint[];
  totalRequests: number;
  totalErrors: number;
  maxP95: number;
  peakConcurrency: number;
  limit: number;
  timedOut: boolean;
}

/** API Gateway → Lambda (synchronous). Concurrency = rps × duration. */
export function simulateSyncLambda(board: Board, fn: Component, profile: ProfilePoint[], durationMin: number, handlerMs: number): SyncLambdaResult {
  const cfg = fn.config as LambdaConfig;
  const limit = lambdaLimit(board, fn);
  const durSec = handlerMs / 1000;
  const timedOut = durSec > APIGW_INTEGRATION_TIMEOUT_SEC || durSec > cfg.timeoutSec;
  const points: TimelinePoint[] = [];
  let totalRequests = 0;
  let totalErrors = 0;
  let maxP95 = 0;
  let peakConcurrency = 0;
  let prevConc = 0;
  for (let m = 0; m < durationMin; m++) {
    const d = demandAt(profile, m);
    const conc = d * Math.min(durSec, cfg.timeoutSec);
    peakConcurrency = Math.max(peakConcurrency, conc);
    const served = timedOut ? 0 : conc <= limit ? d : (d * limit) / conc;
    const errors = d - served;
    const cold = conc > prevConc * 1.1 ? cfg.coldStartMs : 0;
    const p95 = timedOut ? APIGW_INTEGRATION_TIMEOUT_SEC * 1000 : handlerMs + cold;
    prevConc = conc;
    totalRequests += d * 60;
    totalErrors += errors * 60;
    if (d > 0) maxP95 = Math.max(maxP95, p95);
    points.push({ min: m, demand: Math.round(d), capacity: Math.round(durSec > 0 ? limit / durSec : 0), errors: Math.round(errors), p95: Math.round(p95) });
  }
  return { points, totalRequests, totalErrors, maxP95, peakConcurrency, limit, timedOut };
}
