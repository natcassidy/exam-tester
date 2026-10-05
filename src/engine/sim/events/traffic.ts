import type { ConfigOf } from '../../model';
import { traceFlow, failingHop } from '../../net/trace';
import { resolveRef } from '../../select';
import { INSTANCE_RPS_AT_70 } from '../../cost/pricing';
import { demandAt, primaryDbUtil, ProfilePoint, simulateAsg, simulateSyncLambda } from '../capacity';
import { EventHandler, result } from './context';

export interface TrafficParams {
  entry: string; // 'alb' | 'apigw'
  profile: ProfilePoint[];
  durationMin: number;
  slo: { errorRate: number; p95Ms: number };
  baseLatencyMs?: number;
  /** Lambda handler duration for synchronous API Gateway integrations. */
  handlerMs?: number;
  /** DB queries per request and the share that are reads. */
  db?: { queriesPerRequest: number; readFraction: number };
}

const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;

export const traffic: EventHandler = (board, ev) => {
  const p = ev.params as TrafficParams;
  const entry = resolveRef(board, p.entry);
  if (!entry) return result(ev, { status: 'fail', incomplete: true, summary: `No ${p.entry.toUpperCase()} on the board to receive traffic.`, lesson: 'Place the entry point first.', highlight: [] });

  if (entry.config.type === 'alb') {
    const reach = traceFlow(board, { from: 'internet', to: entry.id, protocol: 'tcp', port: entry.config.listener.port });
    if (reach.result === 'dropped') {
      const bad = failingHop(reach);
      return result(ev, { status: 'fail', summary: `100% errors: requests never reach a healthy target. ${bad?.explain ?? ''}`, lesson: 'Fix reachability first; capacity only matters once traffic flows.', highlight: [entry.id], fixTarget: bad?.matched?.objectId ?? bad?.at.id, trace: reach });
    }
    const target = entry.config.targetId ? board.components[entry.config.targetId] : undefined;
    if (!target || target.config.type !== 'asg') return result(ev, { status: 'fail', summary: 'The load balancer target is not an Auto Scaling group, so nothing can scale.', lesson: 'Put the app tier in an Auto Scaling group.', highlight: [entry.id] });
    const cfg = target.config;
    const sim = simulateAsg(cfg, p.profile, p.durationMin, { baseLatencyMs: p.baseLatencyMs });
    let dbErrors = 0;
    let peakDb = 0;
    const db = p.db ? primaryDbUtil(board, 0, 0) : null;
    if (p.db && db) {
      for (const pt of sim.points) {
        const u = primaryDbUtil(board, (pt.demand - pt.errors) * p.db.queriesPerRequest, p.db.readFraction)!.util;
        peakDb = Math.max(peakDb, u);
        if (u > 1) {
          const lostShare = 1 - 1 / u;
          const extra = (pt.demand - pt.errors) * lostShare;
          pt.errors = Math.round(pt.errors + extra);
          dbErrors += extra * 60;
        }
      }
    }
    const errorRate = (sim.totalErrors + dbErrors) / Math.max(1, sim.totalRequests);
    const ok = errorRate <= p.slo.errorRate && sim.maxP95 <= p.slo.p95Ms;
    const peak = Math.max(...p.profile.map((x) => x.rps));
    const lines = [
      { label: 'Error rate', value: `${pct(errorRate)} (SLO ≤ ${pct(p.slo.errorRate)})`, status: errorRate <= p.slo.errorRate ? 'pass' : 'fail' },
      { label: 'Worst-minute p95', value: `${Number.isFinite(sim.maxP95) ? Math.round(sim.maxP95) : '∞'} ms (SLO ≤ ${p.slo.p95Ms} ms)`, status: sim.maxP95 <= p.slo.p95Ms ? 'pass' : 'fail' },
      { label: 'Peak instances', value: `${sim.maxInstances} (max ${cfg.max})` },
      { label: 'Warmup', value: `${cfg.warmupSec}s + ~60s boot before new instances serve` },
    ] as { label: string; value: string; status?: 'pass' | 'fail' }[];
    if (p.db && db) lines.push({ label: 'Peak DB load', value: pct(peakDb), status: peakDb <= 1 ? 'pass' : 'fail' });
    let lesson = 'Target tracking added capacity ahead of the surge, and warmup was covered by headroom.';
    if (!ok) {
      if (sim.maxInstances >= cfg.max && errorRate > p.slo.errorRate) lesson = `The group hit its max capacity (${cfg.max}). ${peak} rps needs about ${Math.ceil(peak / INSTANCE_RPS_AT_70[cfg.instanceType])} instances at 70% CPU. Raise max.`;
      else if (cfg.policy.kind === 'none') lesson = 'No scaling policy: the group never grows. Add target tracking on CPU.';
      else lesson = `New instances only serve after ~60s boot + ${cfg.warmupSec}s warmup. Keep more headroom (a lower target CPU or higher minimum) or scale earlier (scheduled scaling for a known event).`;
      if (p.db && db && peakDb > 1) lesson = `The database is the bottleneck (${pct(peakDb)} of ${db.label} capacity). Add read replicas for reads or a larger instance class.`;
    }
    return result(ev, {
      status: ok ? 'pass' : 'fail',
      summary: ok ? `Survived the surge: ${pct(errorRate)} errors, worst p95 ${Math.round(sim.maxP95)} ms, peaked at ${sim.maxInstances} instances.` : `SLO missed: ${pct(errorRate)} errors, worst p95 ${Number.isFinite(sim.maxP95) ? Math.round(sim.maxP95) + ' ms' : 'unbounded'}.`,
      detail: { lines },
      lesson,
      highlight: ok ? [] : [p.db && db && peakDb > 1 ? db.id : target.id],
      fixTarget: p.db && db && peakDb > 1 ? db.id : target.id,
      timeline: { points: sim.points, marks: sim.marks },
      metrics: { errorRate, p95: sim.maxP95, peakInstances: sim.maxInstances },
    });
  }

  if (entry.config.type === 'apigw') {
    const integ = entry.config.integration;
    const target = integ.targetId ? board.components[integ.targetId] : undefined;
    if (!target) return result(ev, { status: 'fail', summary: `${entry.name} has no integration target. Every request returns 500.`, lesson: 'Point the API at a backend.', highlight: [entry.id], fixTarget: entry.id });
    const throttle = entry.config.throttleRps;
    if (integ.kind === 'sqs' && target.type === 'sqs') {
      const points = Array.from({ length: p.durationMin }, (_, m) => {
        const d = demandAt(p.profile, m);
        const errors = Math.max(0, d - throttle);
        return { min: m, demand: Math.round(d), capacity: throttle, errors: Math.round(errors), p95: 35 };
      });
      const total = points.reduce((s, x) => s + x.demand, 0);
      const errs = points.reduce((s, x) => s + x.errors, 0);
      const errorRate = errs / Math.max(1, total);
      const ok = errorRate <= p.slo.errorRate;
      return result(ev, {
        status: ok ? 'pass' : 'fail',
        summary: ok ? `Every order accepted: API Gateway writes straight to ${target.name} in ~35 ms and returns 202. The queue absorbs the spike.` : `${pct(errorRate)} of requests throttled (429) above ${throttle} rps.`,
        detail: { lines: [{ label: 'Error rate', value: `${pct(errorRate)} (SLO ≤ ${pct(p.slo.errorRate)})`, status: ok ? 'pass' : 'fail' }, { label: 'p95', value: '35 ms' }] },
        lesson: 'Decoupling: accept fast, process asynchronously. The queue turns a spike into a backlog instead of errors.',
        highlight: [],
        timeline: { points },
        metrics: { errorRate, p95: 35 },
      });
    }
    if (integ.kind === 'lambda' && target.type === 'lambda') {
      const sim = simulateSyncLambda(board, target, p.profile, p.durationMin, p.handlerMs ?? 200);
      const errorRate = sim.totalErrors / Math.max(1, sim.totalRequests);
      const ok = errorRate <= p.slo.errorRate && sim.maxP95 <= p.slo.p95Ms;
      let lesson = 'Synchronous Lambda kept up with the load.';
      if (sim.timedOut) lesson = `The handler takes ${(p.handlerMs ?? 0) / 1000}s, but API Gateway's integration timeout is 29s by default (and the function timeout is ${(target.config as ConfigOf<'lambda'>).timeoutSec}s). Long work must be asynchronous: put SQS between the API and the worker.`;
      else if (!ok) lesson = `Peak concurrency needed: ${Math.round(sim.peakConcurrency)} (rps × duration) but the limit is ${sim.limit}. Excess requests get 429 TooManyRequests. Buffer with SQS or raise the account limit.`;
      return result(ev, {
        status: ok ? 'pass' : 'fail',
        summary: ok ? `Handled synchronously: ${pct(errorRate)} errors.` : sim.timedOut ? `100% of requests failed with 504 Gateway Timeout.` : `${pct(errorRate)} of requests throttled: Lambda concurrency limit (${sim.limit}) exceeded.`,
        detail: { lines: [{ label: 'Error rate', value: `${pct(errorRate)} (SLO ≤ ${pct(p.slo.errorRate)})`, status: errorRate <= p.slo.errorRate ? 'pass' : 'fail' }, { label: 'Peak concurrency', value: `${Math.round(sim.peakConcurrency)} / limit ${sim.limit}` }] },
        lesson,
        highlight: ok ? [] : [target.id, entry.id],
        fixTarget: entry.id,
        timeline: { points: sim.points },
        metrics: { errorRate, p95: sim.maxP95, peakConcurrency: sim.peakConcurrency },
      });
    }
    return result(ev, { status: 'fail', summary: `${entry.name}'s integration type doesn't match its target.`, lesson: 'Pick a Lambda or SQS integration and a matching target.', highlight: [entry.id], fixTarget: entry.id });
  }
  return result(ev, { status: 'fail', summary: `${entry.name} can't receive traffic in this model.`, lesson: '', highlight: [entry.id] });
};
