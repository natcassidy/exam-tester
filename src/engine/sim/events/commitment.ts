// Commitment over its term (Stage 4): the fleet plan changes month by month (new instance family,
// part of the work moving to Lambda). Checks that no commitment is stranded and what it saves.

import type { InstanceType } from '../../model';
import { applyCommitments, asgMix, commitmentsOf, PLAN_LABEL, UsageHour } from '../../cost/commitments';
import { HOURS_PER_MONTH as H, PRICING } from '../../cost/pricing';
import { componentsOfType } from '../../board';
import { EventHandler, fmtUsd, result } from './context';

export interface CommitmentParams {
  check: 'stranded' | 'savings';
  /** Fleet plan; the first period must be what runs on the board today. */
  plan: { fromMonth: number; toMonth: number; label: string; ec2: { instanceType: InstanceType; count: number }[]; lambdaOdHourly: number }[];
  /** Fail when more than this share of the committed spend goes unused over the plan. */
  maxWastePct?: number;
  /** Required average saving against On-Demand over the plan. */
  minSavingsPct?: number;
}

export const commitment: EventHandler = (board, ev) => {
  const p = ev.params as CommitmentParams;
  const commits = commitmentsOf(board);
  const savingsIds = componentsOfType(board, 'savings').map((c) => c.id);
  // Today's fleet must still carry the baseline: shrinking it isn't a pricing strategy.
  const todayOd = p.plan[0].ec2.reduce((s, u) => s + u.count * PRICING.ec2Hourly[u.instanceType], 0);
  const boardOd = componentsOfType(board, 'asg').reduce((s, a) => s + (asgMix(a.config).onDemand + asgMix(a.config).spot) * PRICING.ec2Hourly[a.config.instanceType], 0);
  if (boardOd + 1e-9 < todayOd) return result(ev, { status: 'fail', summary: `The fleet on the board no longer carries today's baseline (${p.plan[0].label}).`, lesson: 'The steady load needs the instances it needs. Change how you pay for them, not how many there are.', highlight: componentsOfType(board, 'asg').map((a) => a.id) });

  const months = p.plan[p.plan.length - 1].toMonth;
  let cost = 0;
  let onDemand = 0;
  let wasted = 0;
  let committedTotal = 0;
  const lines: { label: string; value: string; status?: 'pass' | 'warn' | 'fail' }[] = [];
  for (const period of p.plan) {
    const n = period.toMonth - period.fromMonth;
    // A commitment only lasts its term.
    const active = commits.filter((c) => period.fromMonth < c.termYears * 12);
    const usage: UsageHour = { ec2: period.ec2, lambdaOdHourly: period.lambdaOdHourly };
    const h = applyCommitments(active, usage);
    cost += h.cost * H * n;
    onDemand += h.onDemand * H * n;
    wasted += h.wasted * H * n;
    committedTotal += h.committed * H * n;
    const expired = commits.length - active.length;
    lines.push({
      label: `Months ${period.fromMonth + 1}-${period.toMonth}`,
      value: `${period.label}: ${fmtUsd(h.cost * H)}/mo vs ${fmtUsd(h.onDemand * H)} On-Demand${h.wasted > 0.0005 ? `, ${fmtUsd(h.wasted * H)}/mo of commitment unused` : ''}${expired ? ' (term ended)' : ''}`,
      status: h.wasted > 0.0005 ? 'warn' : undefined,
    });
  }
  const monthly = Math.round((cost / months) * 100) / 100;
  const savingsPct = onDemand ? (1 - cost / onDemand) * 100 : 0;
  const wastePct = committedTotal ? (wasted / committedTotal) * 100 : 0;
  const what = commits.length ? commits.map((c) => `${PLAN_LABEL[c.plan]} (${c.termYears} y)`).join(' + ') : 'no commitment';
  const metrics = { monthly, savingsPct, wastePct };
  if (p.check === 'stranded') {
    const ok = wastePct <= (p.maxWastePct ?? 5);
    return result(ev, {
      status: ok ? 'pass' : 'fail',
      summary: ok ? `${what}: ${wastePct.toFixed(1)}% of the commitment goes unused over ${months} months.` : `${what}: ${wastePct.toFixed(0)}% of what you committed to (${fmtUsd(wasted)}) pays for capacity you no longer run.`,
      detail: { lines },
      lesson: ok
        ? 'The commitment follows the workload through the plan.'
        : 'A commitment is paid whether you use it or not. If the workload will change family, Region or move to Lambda/Fargate, commit with a Compute Savings Plan, and size it to the lowest usage you are sure of.',
      highlight: ok ? [] : savingsIds,
      fixTarget: savingsIds[0],
      metrics,
    });
  }
  const min = p.minSavingsPct ?? 0;
  const ok = savingsPct >= min;
  return result(ev, {
    status: ok ? 'pass' : 'fail',
    summary: `${what}: ${fmtUsd(monthly)}/month on average over ${months} months, ${savingsPct.toFixed(1)}% below On-Demand (needs ≥ ${min}%).`,
    detail: { lines },
    lesson: ok ? 'Within target.' : commits.length ? 'Not enough is covered for long enough. A 3-year term discounts more than 1 year, and the commitment must cover the usage that will still be there.' : 'Steady 24/7 usage at On-Demand rates is the most expensive way to run it. Commit to the baseline.',
    highlight: ok ? [] : savingsIds,
    fixTarget: savingsIds[0],
    metrics,
  });
};
