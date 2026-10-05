import type { Component, ConfigOf, InstanceType, SpotAllocation } from '../../engine/model';
import { COMMIT_DISCOUNT, HOURS_PER_MONTH, PRICING, SPOT_PRICE_RATIO } from '../../engine/cost/pricing';
import { asgMix, committedHourly, PLAN_LABEL } from '../../engine/cost/commitments';
import { NumberField, SelectField, Toggle } from './fields';
import { useUpdate } from './refs';
import { INSTANCE_TYPES } from './ConfigPanel';

/** Stage 4: Spot / On-Demand mix on an Auto Scaling group. */
export function PurchaseOptions({ c }: { c: Component }) {
  const update = useUpdate(c);
  const cfg = c.config as ConfigOf<'asg'>;
  const p = cfg.purchase;
  const mix = asgMix(cfg);
  return (
    <div className="section" style={{ marginTop: 10 }}>
      <h4>Purchase options</h4>
      <Toggle
        label="Mix Spot and On-Demand"
        value={!!p}
        onChange={(v) => update({ purchase: v ? { onDemandBase: 0, spotPercent: 100, allocation: 'price-capacity-optimized', extraTypes: [] } : undefined })}
        hint={`Spot ≈ ${Math.round((1 - SPOT_PRICE_RATIO) * 100)}% cheaper, but EC2 can reclaim it with 2 minutes' notice`}
      />
      {p && (
        <>
          <NumberField label="On-Demand base" value={p.onDemandBase} min={0} max={cfg.max} onChange={(v) => update({ purchase: { ...p, onDemandBase: v } })} hint="Instances that are never Spot" />
          <NumberField label="Spot above the base" value={p.spotPercent} min={0} max={100} suffix="%" onChange={(v) => update({ purchase: { ...p, spotPercent: v } })} />
          <SelectField<SpotAllocation>
            label="Spot allocation strategy"
            value={p.allocation}
            options={[
              { value: 'price-capacity-optimized', label: 'price-capacity-optimized (recommended)' },
              { value: 'capacity-optimized', label: 'capacity-optimized' },
              { value: 'lowest-price', label: 'lowest-price' },
            ]}
            onChange={(v) => update({ purchase: { ...p, allocation: v } })}
          />
          <div className="field stack" style={{ display: 'block', padding: '6px 0' }}>
            <span className="hint">More instance types the group may launch (each type × AZ is a Spot pool):</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {INSTANCE_TYPES.filter((t) => t !== cfg.instanceType).map((t) => (
                <label key={t} className="check">
                  <input
                    type="checkbox"
                    checked={p.extraTypes.includes(t)}
                    onChange={(e) => update({ purchase: { ...p, extraTypes: e.target.checked ? [...p.extraTypes, t] : p.extraTypes.filter((x: InstanceType) => x !== t) } })}
                  />
                  <span className="mono">{t}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="hint">
            Desired {cfg.desired}: {mix.onDemand} On-Demand + {mix.spot} Spot.
          </p>
        </>
      )}
    </div>
  );
}

/** Stage 4: a Savings Plan or Reserved Instance commitment. */
export function SavingsConfig({ c }: { c: Component }) {
  const update = useUpdate(c);
  const cfg = c.config as ConfigOf<'savings'>;
  const sp = cfg.plan === 'compute-sp' || cfg.plan === 'ec2-instance-sp';
  const disc = COMMIT_DISCOUNT[cfg.plan][cfg.termYears];
  return (
    <>
      <SelectField
        label="Commitment"
        value={cfg.plan}
        options={(Object.keys(PLAN_LABEL) as (keyof typeof PLAN_LABEL)[]).map((k) => ({ value: k, label: PLAN_LABEL[k] }))}
        onChange={(v) => update({ plan: v })}
      />
      <SelectField label="Term" value={String(cfg.termYears) as '1' | '3'} options={[{ value: '1', label: '1 year' }, { value: '3', label: '3 years' }]} onChange={(v) => update({ termYears: Number(v) as 1 | 3 })} hint="No Upfront payment" />
      {sp && <NumberField label="Hourly commitment" value={cfg.hourlyCommit} min={0.001} step={0.01} suffix="$/hour" onChange={(v) => update({ hourlyCommit: v })} hint="Spend per hour at the discounted rate, used or not" />}
      {(cfg.plan !== 'compute-sp') && (
        <SelectField<InstanceType>
          label={cfg.plan === 'ec2-instance-sp' ? 'Instance family (from type)' : 'Instance type reserved'}
          value={cfg.instanceType}
          options={INSTANCE_TYPES.map((t) => ({ value: t, label: t }))}
          onChange={(v) => update({ instanceType: v })}
        />
      )}
      {!sp && <NumberField label="Instances" value={cfg.count} min={1} max={100} onChange={(v) => update({ count: v })} />}
      <p className="hint">
        ≈ {Math.round(disc * 100)}% off On-Demand (approximate). Costs ${(committedHourly(cfg) * HOURS_PER_MONTH).toFixed(2)}/month whether or not it is used.
        {cfg.plan === 'compute-sp' && ' Applies to any EC2 family, size or Region, and to Lambda and Fargate.'}
        {cfg.plan === 'ec2-instance-sp' && ` Applies to the ${cfg.instanceType.split('.')[0]} family in this Region only.`}
        {cfg.plan === 'standard-ri' && ` Size-flexible within the ${cfg.instanceType.split('.')[0]} family; the family can't change.`}
        {cfg.plan === 'convertible-ri' && ' Can be exchanged for another EC2 family; does not cover Lambda or Fargate.'}
      </p>
      <p className="hint">On-Demand for comparison: {cfg.instanceType} ≈ ${(PRICING.ec2Hourly[cfg.instanceType] * HOURS_PER_MONTH).toFixed(2)}/month.</p>
    </>
  );
}
