// S3 lifecycle over a retention period: steady-state monthly cost once every age is present,
// retrieval time at each age, minimum storage duration charges, and AZ resilience.

import type { ConfigOf, S3StorageClass } from '../../model';
import { S3_CLASSES, S3_INTELLIGENT } from '../../cost/pricing';
import { resolveRef } from '../../select';
import { EventHandler, fmtSec, fmtUsd, result } from './context';

export interface StorageLifecycleParams {
  check: 'retrieval' | 'retention' | 'resilience' | 'cost';
  monthlyNewGb: number;
  avgObjectMb: number;
  retentionDays: number;
  /** Share of the objects of a given age read in a month. */
  reads: { fromDay: number; toDay: number; pctPerMonth: number }[];
  retrieval: { fromDay: number; toDay: number; maxSec: number; label: string }[];
  budget?: number;
  target?: string;
}

export function classAt(cfg: ConfigOf<'s3'>, day: number): S3StorageClass {
  let cls: S3StorageClass = cfg.storageClass ?? 'STANDARD';
  for (const t of [...(cfg.lifecycle ?? [])].sort((a, b) => a.afterDays - b.afterDays)) if (day >= t.afterDays) cls = t.toClass;
  return cls;
}

export interface LifecycleCost {
  monthly: number;
  items: { item: string; monthly: number }[];
  earlyDays: number;
}

/** Monthly bill once objects of every age (one cohort per month) are present. */
export function lifecycleCost(cfg: ConfigOf<'s3'>, p: StorageLifecycleParams, horizonDays: number): LifecycleCost {
  const by: Record<string, number> = {};
  const add = (k: string, v: number) => (by[k] = (by[k] ?? 0) + v);
  const objectsPerMonth = (p.monthlyNewGb * 1024) / p.avgObjectMb;
  const readPct = (day: number) => p.reads.find((r) => day >= r.fromDay && day < r.toDay)?.pctPerMonth ?? 0;
  const life = cfg.expireAfterDays ?? horizonDays;
  // Walk one cohort through its life month by month (30-day months).
  for (let day = 0; day < life; day += 30) {
    const span = Math.min(30, life - day) / 30;
    const cls = classAt(cfg, day);
    const c = S3_CLASSES[cls];
    let gbMonth = c.gbMonth;
    // Intelligent-Tiering moves objects down after 30 / 90 days without access, and back to the
    // frequent tier when read: roughly the share read each month sits in the frequent tier.
    if (cls === 'INTELLIGENT_TIERING') {
      const cold = day < 30 ? 0.023 : day < 90 ? S3_INTELLIGENT.infrequentGbMonth : S3_INTELLIGENT.archiveInstantGbMonth;
      const hot = Math.min(1, readPct(day) / 100);
      gbMonth = hot * 0.023 + (1 - hot) * cold;
    }
    add(`Storage: ${c.label}`, p.monthlyNewGb * gbMonth * span);
    if (cls === 'INTELLIGENT_TIERING') add('Intelligent-Tiering monitoring', (objectsPerMonth / 1000) * S3_INTELLIGENT.monitoringPer1kObjects * span);
    add(`Retrievals from ${c.label}`, p.monthlyNewGb * (readPct(day) / 100) * c.retrievalPerGb * span);
  }
  let prevDay = 0;
  let earlyDays = 0;
  for (const t of [...(cfg.lifecycle ?? [])].sort((a, b) => a.afterDays - b.afterDays)) {
    if (t.afterDays >= life) break;
    add(`Lifecycle transitions to ${S3_CLASSES[t.toClass].label}`, (objectsPerMonth / 1000) * S3_CLASSES[t.toClass].transitionPer1k);
    const from = classAt(cfg, prevDay);
    const shortBy = S3_CLASSES[from].minDays - (t.afterDays - prevDay);
    if (shortBy > 0) {
      add(`Early transition charge (${S3_CLASSES[from].label} minimum ${S3_CLASSES[from].minDays} days)`, p.monthlyNewGb * S3_CLASSES[from].gbMonth * (shortBy / 30));
      earlyDays = Math.max(earlyDays, shortBy);
    }
    prevDay = t.afterDays;
  }
  if (cfg.expireAfterDays != null) {
    const last = classAt(cfg, cfg.expireAfterDays - 1);
    const shortBy = S3_CLASSES[last].minDays - (cfg.expireAfterDays - prevDay);
    if (shortBy > 0) {
      add(`Early deletion charge (${S3_CLASSES[last].label} minimum ${S3_CLASSES[last].minDays} days)`, p.monthlyNewGb * S3_CLASSES[last].gbMonth * (shortBy / 30));
      earlyDays = Math.max(earlyDays, shortBy);
    }
  }
  const items = Object.entries(by)
    .map(([item, monthly]) => ({ item, monthly: Math.round(monthly * 100) / 100 }))
    .filter((x) => x.monthly > 0.004)
    .sort((a, b) => b.monthly - a.monthly);
  return { monthly: Math.round(items.reduce((s, i) => s + i.monthly, 0) * 100) / 100, items, earlyDays };
}

const fmtAge = (d: number) => (d >= 365 ? `${(d / 365).toFixed(d % 365 ? 1 : 0)} y` : `${d} d`);

export const storageLifecycle: EventHandler = (board, ev) => {
  const p = ev.params as StorageLifecycleParams;
  const b = resolveRef(board, p.target ?? 's3');
  if (!b || b.config.type !== 's3') return result(ev, { status: 'fail', summary: 'There is no bucket on the board yet.', lesson: 'Place the bucket first.', highlight: [] });
  const cfg = b.config;
  const schedule = [{ afterDays: 0, toClass: cfg.storageClass ?? 'STANDARD' }, ...[...(cfg.lifecycle ?? [])].sort((a, c) => a.afterDays - c.afterDays)];
  const scheduleLine = { label: 'Lifecycle', value: `${schedule.map((t) => `${fmtAge(t.afterDays)}: ${S3_CLASSES[t.toClass].label}`).join(' → ')}${cfg.expireAfterDays != null ? ` → expire at ${fmtAge(cfg.expireAfterDays)}` : ' → kept forever'}` };
  const fail = (summary: string, lesson: string, extra: { label: string; value: string; status?: 'pass' | 'fail' }[] = [], metrics?: Record<string, number>) => result(ev, { status: 'fail', summary, detail: { lines: [scheduleLine, ...extra] }, lesson, highlight: [b.id], fixTarget: b.id, metrics });
  const pass = (summary: string, lesson: string, extra: { label: string; value: string; status?: 'pass' | 'fail' }[] = [], metrics?: Record<string, number>) => result(ev, { status: 'pass', summary, detail: { lines: [scheduleLine, ...extra] }, lesson, highlight: [], metrics });

  if (p.check === 'retrieval') {
    const lines = p.retrieval.map((w) => {
      const classes = [...new Set(schedule.filter((t, i) => (schedule[i + 1]?.afterDays ?? Infinity) > w.fromDay && t.afterDays < w.toDay).map((t) => t.toClass))];
      const slow = classes.filter((c) => S3_CLASSES[c].firstByteSec > w.maxSec);
      return { w, slow, line: { label: w.label, value: `${fmtAge(w.fromDay)}-${fmtAge(w.toDay)}: ${classes.map((c) => `${S3_CLASSES[c].label} (${S3_CLASSES[c].firstByte})`).join(', ')}; needed within ${fmtSec(w.maxSec)}.`, status: slow.length ? ('fail' as const) : ('pass' as const) } };
    });
    const bad = lines.find((l) => l.slow.length);
    if (bad) return fail(`${bad.w.label}: objects aged ${fmtAge(bad.w.fromDay)}-${fmtAge(bad.w.toDay)} sit in ${S3_CLASSES[bad.slow[0]].label}, which returns the first byte in ${S3_CLASSES[bad.slow[0]].firstByte}. Requirement: ${fmtSec(bad.w.maxSec)}.`, 'Glacier Flexible Retrieval and Deep Archive need a restore request before you can read an object. Use Glacier Instant Retrieval or an IA class while objects must be readable in milliseconds.', lines.map((l) => l.line));
    return pass('Every object can be read within its required time at every age.', 'Archive classes are only safe once slow retrieval is acceptable.', lines.map((l) => l.line));
  }
  if (p.check === 'retention') {
    if (cfg.expireAfterDays == null) return fail(`Nothing ever deletes the objects. The policy says delete after ${fmtAge(p.retentionDays)}; the bucket keeps growing forever.`, 'Add a lifecycle expiration action at the end of the retention period.');
    if (cfg.expireAfterDays < p.retentionDays) return fail(`Objects expire at ${fmtAge(cfg.expireAfterDays)}, before the required ${fmtAge(p.retentionDays)} retention.`, 'Expire at (or just after) the end of the retention period, never before.');
    if (cfg.expireAfterDays > p.retentionDays + 31) return fail(`Objects are kept until ${fmtAge(cfg.expireAfterDays)}, well past the ${fmtAge(p.retentionDays)} the policy allows.`, 'Keeping data longer than the policy allows is a compliance finding and a cost.');
    return pass(`Objects expire at ${fmtAge(cfg.expireAfterDays)}, right after the ${fmtAge(p.retentionDays)} retention period.`, 'Lifecycle expiration enforces the retention policy automatically.');
  }
  if (p.check === 'resilience') {
    const oz = schedule.find((t) => S3_CLASSES[t.toClass].azs === 1);
    if (oz) return fail(`From ${fmtAge(oz.afterDays)} objects live in ${S3_CLASSES[oz.toClass].label}: a single Availability Zone. If that AZ is destroyed, those scans are gone.`, 'One Zone-IA is for data you can re-create. Records you must keep belong in a class that stores data across at least three AZs.');
    return pass('Every class in the lifecycle stores data across at least three Availability Zones.', 'S3 Standard, IA, Glacier classes: ≥ 3 AZs. One Zone-IA: one.');
  }
  const horizon = Math.max(p.retentionDays, cfg.expireAfterDays ?? p.retentionDays);
  const cost = lifecycleCost(cfg, p, horizon);
  const budget = p.budget ?? Infinity;
  const lines = cost.items.map((i) => ({ label: fmtUsd(i.monthly), value: i.item }));
  const totalGb = Math.round(p.monthlyNewGb * (Math.min(horizon, cfg.expireAfterDays ?? horizon) / 30));
  const summary = `Steady state (${totalGb.toLocaleString()} GB stored, every age present): ${fmtUsd(cost.monthly)}/month (approximate) against ${fmtUsd(budget)}.`;
  if (cost.monthly > budget) return fail(`${summary} ${fmtUsd(cost.monthly - budget)} over.`, `Biggest line: ${cost.items[0]?.item}. Move data down the classes as soon as its access pattern allows, but not into a class whose retrieval time or minimum duration breaks a requirement.`, lines, { monthly: cost.monthly, budget });
  return pass(summary, cost.earlyDays ? 'Within budget, but some objects pay minimum-duration charges: check the transition days.' : 'Within budget.', lines, { monthly: cost.monthly, budget });
};
