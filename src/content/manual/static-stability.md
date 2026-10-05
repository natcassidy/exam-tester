# Static stability

## What it is
A design that keeps working through a failure **without needing to change anything** (no scaling, no launches, no control-plane calls) during the event.

## How it actually works
- Over-provision so that the surviving AZs can carry the full load: with 2 AZs each AZ must handle 100% (so run at ≤ 50% each); with 3 AZs each must handle 50%.
- Replacements still launch, but you don't depend on them arriving fast.
- Pre-provision NAT gateways, standbys and capacity in every AZ rather than creating them after a failure.

| Design | Load per AZ (normal) | After losing 1 AZ |
|---|---|---|
| 2 AZ, sized at exactly 100% | 50% | 100% overloaded on one AZ → errors until relaunch |
| 2 AZ, 200% provisioned | 50% of half capacity | Fine |
| 3 AZ, 150% provisioned | 33% | 50% per surviving AZ: fine |

## Numbers that matter
- Relaunching takes detection + launch + warmup: often 5+ minutes, longer than many RTOs.

## Common exam traps
- "Must keep serving during an AZ failure with no performance impact" → enough capacity in the remaining AZs *already running*.

## Related
[[asg-scaling]] · [[rds-multi-az]] · [[nat-gateway]]
