import type { ConfigOf, TimelinePoint } from '../../model';
import { INSTANCE_RPS_AT_70 } from '../../cost/pricing';
import { failingHop, traceFlow } from '../../net/trace';
import { resolveRef } from '../../select';
import { p95Latency } from '../capacity';
import { EventHandler, result } from './context';

export interface FleetHealthParams {
  entry: string; // the load balancer ref
  loadRps: number;
  durationMin: number;
  /** Instances whose application process has died at minute 0 (the OS keeps running). */
  crashed?: number;
  /** Seconds from instance boot until the application answers health checks. */
  appBootSec: number;
  slo: { errorRate: number };
  baseLatencyMs?: number;
}

interface Inst {
  launchedAt: number;
  crashed: boolean;
}

const pct = (x: number) => `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;

/**
 * Minute-by-minute target health and Auto Scaling replacement.
 * - The ALB health check passes when the app is up and serves the configured path.
 * - With health check type ELB, the group terminates and replaces targets that fail ELB health
 *   checks once the grace period has passed. With EC2, only instance status checks count, so an
 *   instance whose app crashed stays InService forever (a zombie).
 * - If no target is healthy, the ALB fails open and routes to every registered target.
 */
export const fleetHealth: EventHandler = (board, ev) => {
  const p = ev.params as FleetHealthParams;
  const alb = resolveRef(board, p.entry);
  if (!alb || alb.config.type !== 'alb') return result(ev, { status: 'fail', incomplete: true, summary: 'No load balancer on the board.', lesson: 'Place the entry point first.', highlight: [] });
  const target = alb.config.targetId ? board.components[alb.config.targetId] : undefined;
  if (!target || target.config.type !== 'asg') return result(ev, { status: 'fail', summary: `${alb.name}'s target is not an Auto Scaling group.`, lesson: 'Register an Auto Scaling group as the target.', highlight: [alb.id], fixTarget: alb.id });
  const reach = traceFlow(board, { from: 'internet', to: alb.id, protocol: 'tcp', port: alb.config.listener.port });
  if (reach.result === 'dropped') {
    const bad = failingHop(reach);
    return result(ev, { status: 'fail', summary: `Requests never reach the fleet: ${bad?.explain ?? 'no path.'}`, lesson: 'Fix reachability first.', highlight: [alb.id], fixTarget: bad?.matched?.objectId ?? bad?.at.id, trace: reach });
  }
  const hc = alb.config.healthCheck;
  const cfg = target.config as ConfigOf<'asg'>;
  const pathOk = cfg.app.healthPath === hc.path;
  const perInstance = INSTANCE_RPS_AT_70[cfg.instanceType] / 0.7;
  const detectMin = Math.max(1, Math.ceil((hc.intervalSec * hc.unhealthyThreshold) / 60));
  const healthyAfterMin = Math.ceil((hc.intervalSec * hc.healthyThreshold) / 60);
  const graceMin = cfg.healthCheckGraceSec / 60;
  const bootMin = 1 + p.appBootSec / 60;
  const base = p.baseLatencyMs ?? 60;

  let fleet: Inst[] = Array.from({ length: cfg.desired }, (_, i) => ({ launchedAt: -120, crashed: i < (p.crashed ?? 0) }));
  const ready = (x: Inst, m: number) => m >= x.launchedAt + bootMin && !x.crashed;
  const passing = (x: Inst, m: number) => ready(x, m) && pathOk;
  const healthy = (x: Inst, m: number) => passing(x, m) && m >= x.launchedAt + bootMin + healthyAfterMin;

  const points: TimelinePoint[] = [];
  const marks: { min: number; label: string }[] = [];
  let replacements = 0;
  let total = 0;
  let errors = 0;
  let failOpenMins = 0;
  for (let m = 0; m < p.durationMin; m++) {
    // Auto Scaling health: ELB checks after the grace period; EC2 status checks never see a dead app.
    if (cfg.healthCheckType === 'ELB') {
      // A crashed app fails from minute 0; a new or misconfigured one has failed since launch.
      const failingSince = (x: Inst) => (x.crashed ? Math.max(0, x.launchedAt) : x.launchedAt);
      const doomed = fleet.filter((x) => m >= x.launchedAt + graceMin && !passing(x, m) && m - failingSince(x) >= detectMin);
      if (doomed.length) {
        fleet = fleet.filter((x) => !doomed.includes(x));
        for (let i = 0; i < doomed.length; i++) fleet.push({ launchedAt: m, crashed: false });
        replacements += doomed.length;
        marks.push({ min: m, label: `replaced ${doomed.length}` });
      }
    }
    const d = p.loadRps;
    const h = fleet.filter((x) => healthy(x, m));
    let served: number;
    if (h.length) served = Math.min(d, h.length * perInstance);
    else {
      failOpenMins++;
      const up = fleet.filter((x) => ready(x, m)).length;
      served = fleet.length ? Math.min((d * up) / fleet.length, up * perInstance) : 0;
    }
    const err = d - served;
    const cap = h.length ? h.length * perInstance : fleet.filter((x) => ready(x, m)).length * perInstance;
    total += d * 60;
    errors += err * 60;
    points.push({ min: m, demand: d, capacity: Math.round(cap * 0.7), errors: Math.round(err), p95: Math.round(Math.min(cap > 0 ? p95Latency(base, d / cap) : 99999, 99999)), instances: h.length });
  }
  const end = p.durationMin - 1;
  const healthyEnd = fleet.filter((x) => healthy(x, end)).length;
  const zombies = fleet.filter((x) => x.crashed).length;
  const errorRate = errors / Math.max(1, total);
  const ok = errorRate <= p.slo.errorRate && healthyEnd === cfg.desired;
  const lines = [
    { label: 'Error rate', value: `${pct(errorRate)} (SLO ≤ ${pct(p.slo.errorRate)})`, status: errorRate <= p.slo.errorRate ? 'pass' : 'fail' },
    { label: 'Healthy targets at the end', value: `${healthyEnd}/${cfg.desired}`, status: healthyEnd === cfg.desired ? 'pass' : 'fail' },
    { label: 'Instances replaced', value: String(replacements) },
    { label: 'Health check', value: `${hc.path} every ${hc.intervalSec}s; app serves ${cfg.app.healthPath}${pathOk ? '' : ' ✗'}` },
    { label: 'ASG health check type', value: `${cfg.healthCheckType}, grace ${cfg.healthCheckGraceSec}s (app needs ~${60 + p.appBootSec}s to boot)` },
  ] as { label: string; value: string; status?: 'pass' | 'fail' }[];
  if (failOpenMins) lines.push({ label: 'Fail-open minutes', value: `${failOpenMins} (no healthy target, so the ALB routed to every registered target)` });

  let lesson = 'Unhealthy targets are detected and replaced; the fleet stays at full strength.';
  let summary = `Fleet healthy: ${healthyEnd}/${cfg.desired} targets, ${pct(errorRate)} errors.`;
  if (!pathOk) {
    summary = `Target group 0/${cfg.desired} healthy: health checks request ${hc.path}, the app serves ${cfg.app.healthPath}.${cfg.healthCheckType === 'ELB' ? ` Auto Scaling replaced ${replacements} instances in ${p.durationMin} min and users saw ${pct(errorRate)} errors.` : ' The ALB is failing open, so traffic still flows, but health checks protect nothing.'}`;
    lesson = `Every target fails the health check because of the path, not the app. ${cfg.healthCheckType === 'ELB' ? 'With ELB health checks, Auto Scaling terminates each "unhealthy" instance after the grace period, so the fleet churns and capacity keeps dropping to zero (HTTP 503 when nothing is registered).' : ''} Fix the health check path on the target group.`;
  } else if (zombies) {
    summary = `${zombies} zombie instance(s) stay InService with a dead app: ${healthyEnd}/${cfg.desired} healthy, ${pct(errorRate)} errors.`;
    lesson = `The ALB stopped sending traffic to the crashed instances, but the Auto Scaling group uses ${cfg.healthCheckType} health checks, which only look at the instance status. It never replaces them. Use ELB health checks so the group acts on what the load balancer sees.`;
  } else if (replacements > (p.crashed ?? 0)) {
    summary = `Replacement loop: ${replacements} instances terminated in ${p.durationMin} min. ${pct(errorRate)} errors.`;
    lesson = `New instances are killed before the app finishes booting: the health check grace period (${cfg.healthCheckGraceSec}s) is shorter than boot + app start (~${60 + p.appBootSec}s). Set the grace period longer than the startup time.`;
  } else if (!ok) {
    summary = `${pct(errorRate)} errors while the fleet recovered.`;
    lesson = 'Recovery is too slow for the error budget. Shorten detection (interval × unhealthy threshold) or carry more headroom.';
  }
  return result(ev, {
    status: ok ? 'pass' : 'fail',
    summary,
    detail: { lines },
    lesson,
    highlight: ok ? [] : [pathOk ? target.id : alb.id],
    fixTarget: pathOk ? target.id : alb.id,
    timeline: { points, marks },
    metrics: { errorRate, healthyEnd, replacements },
  });
};
