# Auto Scaling policies and warmup

## What it is
An Auto Scaling group keeps a number of instances (min ≤ desired ≤ max) running across chosen subnets, replaces unhealthy ones and changes desired capacity with scaling policies.

## How it actually works
| Policy | How it decides | Best for |
|---|---|---|
| Target tracking | Keeps a metric (e.g. CPU 50%) near target: desired ≈ current × metric / target | Most workloads |
| Step scaling | Adds/removes N instances at alarm thresholds | Fine control of big jumps |
| Scheduled | Sets capacity at a time | Known events (09:00 rush, month-end) |
| Predictive | Forecasts from history | Recurring daily/weekly patterns |

- **Instance warmup** (default 300 s): a new instance's metrics are ignored until it is warmed up, so the group doesn't over-scale. The instance only *serves* once it has booted and passed health checks.
- Capacity is capped at **max**: scaling stops there no matter what the metric says.
- Health check type `EC2` (instance status) or `ELB` (load balancer health checks; set a grace period).

## Numbers that matter
- New capacity arrives after roughly boot (≈ 1 min) + warmup. A spike faster than that produces errors unless you have headroom.

## Common exam traps
- Predictable spike → scheduled (or predictive) scaling ahead of it.
- Errors at peak with the group at max → raise max, not the target.

## Related
[[static-stability]] · [[alb-health-checks]]
