// Spot capacity crunch (Stage 4). Demand for the cheapest instance pools spikes and EC2 reclaims
// Spot capacity there with a two-minute warning. Each instance type in each AZ is a separate pool.
// - lowest-price launches Spot into the cheapest pools (SpotInstancePools = 2), exactly the contested ones;
// - capacity-optimized / price-capacity-optimized launch into the deepest pools, which the crunch
//   doesn't reach, but only if the group may use more than one instance type;
// - the On-Demand base is never reclaimed: it is the fallback capacity.

import type { ConfigOf } from '../../model';
import { asgMix } from '../../cost/commitments';
import { resolveRef } from '../../select';
import { subnetsOf } from '../../board';
import { EventHandler, result } from './context';

export interface SpotReclaimParams {
  target?: string;
  /** Instances the workload needs at all times. */
  requiredInstances: number;
  crunchMin: number;
}

export const spotReclaim: EventHandler = (board, ev) => {
  const p = ev.params as SpotReclaimParams;
  const asg = resolveRef(board, p.target ?? 'asg');
  if (!asg || asg.config.type !== 'asg') return result(ev, { status: 'fail', incomplete: true, summary: 'There is no Auto Scaling group on the board to run the batch.', lesson: 'Place the worker fleet first.', highlight: [] });
  const cfg = asg.config as ConfigOf<'asg'>;
  const purchase = cfg.purchase;
  const mix = asgMix(cfg);
  const types = [cfg.instanceType, ...(purchase?.extraTypes ?? [])];
  const azs = Math.max(1, subnetsOf(asg).length);
  const allocation = purchase?.allocation ?? 'lowest-price';
  let lost = 0;
  let why = '';
  if (mix.spot === 0) why = 'No Spot capacity: nothing can be reclaimed.';
  else if (allocation === 'lowest-price') {
    lost = types.length >= 2 ? Math.ceil(mix.spot / 2) : mix.spot;
    why =
      types.length >= 2
        ? `lowest-price spread the ${mix.spot} Spot instance(s) over the two cheapest pools per AZ, and the cheapest pools are exactly the ones being reclaimed: ${lost} lost.`
        : `With one instance type, every Spot instance sits in the same ${cfg.instanceType} pools, the cheapest and most contested ones: all ${lost} reclaimed.`;
  } else if (types.length < 2) {
    lost = mix.spot;
    why = `${allocation} can only choose among the pools you allow. With one instance type (${cfg.instanceType}) there is nowhere deeper to go: all ${lost} Spot instance(s) reclaimed.`;
  } else why = `${allocation} placed the Spot instances in the deepest of ${types.length * azs} pools (${types.length} types × ${azs} AZs), away from the contested ones. Nothing reclaimed.`;
  const floor = cfg.desired - lost;
  const ok = floor >= p.requiredInstances;
  const lines = [
    { label: 'Capacity', value: `${cfg.desired} desired: ${mix.onDemand} On-Demand + ${mix.spot} Spot` },
    { label: 'Instance types', value: `${types.join(', ')} (${types.length * azs} Spot pools)` },
    { label: 'Allocation', value: mix.spot ? allocation : 'n/a (all On-Demand)' },
    { label: 'During the crunch', value: `${floor} running for ${p.crunchMin} min (needs ≥ ${p.requiredInstances})`, status: ok ? ('pass' as const) : ('fail' as const) },
  ];
  return result(ev, {
    status: ok ? 'pass' : 'fail',
    summary: ok ? `Survived the Spot crunch with ${floor} instances running. ${why}` : `Only ${floor} instance(s) left for ${p.crunchMin} minutes; the batch needs ${p.requiredInstances}. ${why}`,
    detail: { lines },
    lesson: ok
      ? 'Diversify across instance types and AZs, let a capacity-aware allocation strategy pick the pools, and keep an On-Demand base for capacity you can never lose.'
      : 'Spot is cheap because it can be taken back. Allow several instance types (more pools), use capacity-optimized or price-capacity-optimized allocation, and keep an On-Demand base sized to what you can never lose.',
    highlight: ok ? [] : [asg.id],
    fixTarget: asg.id,
    metrics: { floor, lost },
  });
};
