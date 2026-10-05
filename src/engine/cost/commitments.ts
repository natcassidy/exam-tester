// Savings Plans and Reserved Instances (Stage 4). A commitment changes what usage costs:
// - Compute Savings Plan: $/hour commitment, applies to any EC2 family, size, Region, and to Lambda.
// - EC2 Instance Savings Plan: $/hour commitment, one instance family in one Region, any size.
// - Standard RI: a number of instances of one family (size-flexible within it); can't change family.
// - Convertible RI: like a Standard RI, but can be exchanged for another family (EC2 only).
// Unused commitment is still paid: that is the "stranded commitment" trap.

import type { Board, CommitmentPlan, InstanceType, SavingsConfig } from '../model';
import { componentsOfType } from '../board';
import { COMMIT_DISCOUNT, COMPUTE_SP_LAMBDA_DISCOUNT, PRICING } from './pricing';

export interface UsageHour {
  ec2: { instanceType: InstanceType; count: number }[];
  /** Lambda spend per hour at On-Demand rates. */
  lambdaOdHourly: number;
}

export interface CommitmentHour {
  /** What the hour costs: commitments (used or not) + uncovered usage at On-Demand rates. */
  cost: number;
  /** The same usage with no commitment. */
  onDemand: number;
  /** Commitment paid for but not used this hour. */
  wasted: number;
  /** Commitment cost per hour. */
  committed: number;
}

export const familyOf = (t: InstanceType) => t.split('.')[0];

/** Normalisation factor within a family (large = 4, as in AWS's size-flexibility table). */
const SIZE_UNITS: Record<string, number> = { micro: 0.5, small: 1, medium: 2, large: 4, xlarge: 8 };
export const unitsOf = (t: InstanceType) => SIZE_UNITS[t.split('.')[1]] ?? 4;

export const PLAN_LABEL: Record<CommitmentPlan, string> = {
  'compute-sp': 'Compute Savings Plan',
  'ec2-instance-sp': 'EC2 Instance Savings Plan',
  'standard-ri': 'Standard Reserved Instances',
  'convertible-ri': 'Convertible Reserved Instances',
};

/** Hourly cost of a commitment, whether used or not. */
export function committedHourly(c: SavingsConfig): number {
  if (c.plan === 'compute-sp' || c.plan === 'ec2-instance-sp') return c.hourlyCommit;
  return c.count * PRICING.ec2Hourly[c.instanceType] * (1 - COMMIT_DISCOUNT[c.plan][c.termYears]);
}

/**
 * Apply commitments to one hour of usage. Reserved Instances apply first, then Savings Plans
 * (EC2 Instance SP before Compute SP), each to the usage with the highest discount first, as AWS does.
 * A Convertible RI is assumed exchanged into whichever family is running.
 */
export function applyCommitments(commits: SavingsConfig[], usage: UsageHour): CommitmentHour {
  // Remaining On-Demand value per family, plus Lambda.
  const odByFamily: Record<string, number> = {};
  const unitsByFamily: Record<string, number> = {};
  for (const u of usage.ec2) {
    const f = familyOf(u.instanceType);
    odByFamily[f] = (odByFamily[f] ?? 0) + u.count * PRICING.ec2Hourly[u.instanceType];
    unitsByFamily[f] = (unitsByFamily[f] ?? 0) + u.count * unitsOf(u.instanceType);
  }
  const onDemand = Object.values(odByFamily).reduce((a, b) => a + b, 0) + usage.lambdaOdHourly;
  let lambda = usage.lambdaOdHourly;
  let committed = 0;
  let wasted = 0;
  const order: CommitmentPlan[] = ['standard-ri', 'convertible-ri', 'ec2-instance-sp', 'compute-sp'];
  for (const plan of order)
    for (const c of commits.filter((x) => x.plan === plan)) {
      const cost = committedHourly(c);
      committed += cost;
      if (plan === 'standard-ri' || plan === 'convertible-ri') {
        // Size-flexible within a family. A Convertible RI is exchanged into whichever family runs.
        let units = c.count * unitsOf(c.instanceType);
        const families = plan === 'standard-ri' ? [familyOf(c.instanceType)] : Object.keys(odByFamily).sort((a, b) => odByFamily[b] - odByFamily[a]);
        for (const f of families) {
          if (units <= 0 || !unitsByFamily[f]) continue;
          const perUnit = odByFamily[f] / unitsByFamily[f];
          const used = Math.min(units, unitsByFamily[f]);
          unitsByFamily[f] -= used;
          odByFamily[f] -= used * perUnit;
          units -= used;
        }
        // An exchanged RI keeps its dollar value: the share of units left unused is wasted.
        wasted += cost * (units / (c.count * unitsOf(c.instanceType)));
        continue;
      }
      let left = cost;
      const disc = COMMIT_DISCOUNT[plan][c.termYears];
      const families = plan === 'ec2-instance-sp' ? [familyOf(c.instanceType)] : Object.keys(odByFamily).sort();
      for (const f of families) {
        const od = odByFamily[f] ?? 0;
        if (left <= 0 || od <= 0) continue;
        const coverOd = Math.min(od, left / (1 - disc));
        odByFamily[f] = od - coverOd;
        if (unitsByFamily[f]) unitsByFamily[f] *= odByFamily[f] / od;
        left -= coverOd * (1 - disc);
      }
      if (plan === 'compute-sp' && left > 0 && lambda > 0) {
        const ld = COMPUTE_SP_LAMBDA_DISCOUNT[c.termYears];
        const coverOd = Math.min(lambda, left / (1 - ld));
        lambda -= coverOd;
        left -= coverOd * (1 - ld);
      }
      wasted += Math.max(0, left);
    }
  const uncovered = Object.values(odByFamily).reduce((a, b) => a + Math.max(0, b), 0) + lambda;
  return { cost: committed + uncovered, onDemand, wasted, committed };
}

/** The board's commitments. */
export function commitmentsOf(board: Board): SavingsConfig[] {
  return componentsOfType(board, 'savings').map((c) => c.config);
}

/** EC2 usage the board runs right now at On-Demand rates (ASG On-Demand share + single instances). */
export function boardEc2Usage(board: Board): UsageHour['ec2'] {
  const out: UsageHour['ec2'] = [];
  for (const c of Object.values(board.components)) {
    if (c.config.type === 'ec2') out.push({ instanceType: c.config.instanceType, count: 1 });
    if (c.config.type === 'asg') out.push({ instanceType: c.config.instanceType, count: asgMix(c.config).onDemand });
  }
  return out.filter((u) => u.count > 0);
}

/** On-Demand / Spot split of an Auto Scaling group's desired capacity. */
export function asgMix(cfg: { desired: number; purchase?: { onDemandBase: number; spotPercent: number } }): { onDemand: number; spot: number } {
  const p = cfg.purchase;
  if (!p) return { onDemand: cfg.desired, spot: 0 };
  const base = Math.min(cfg.desired, p.onDemandBase);
  const above = cfg.desired - base;
  // AWS rounds the On-Demand share of the capacity above the base up.
  const odAbove = Math.ceil((above * (100 - p.spotPercent)) / 100);
  return { onDemand: base + odAbove, spot: above - odAbove };
}
