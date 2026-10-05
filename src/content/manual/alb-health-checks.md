# Target group health checks

## What it is
The load balancer regularly calls each target (for example `GET /health`). Targets that fail enough consecutive checks stop receiving traffic.

## How it actually works
- Settings: protocol/port/path, **interval** (default 30 s), timeout (5 s), **healthy threshold** (5), **unhealthy threshold** (2), success codes (200).
- A target becomes unhealthy after `interval × unhealthyThreshold` (default 60 s) of failures.
- The health check is a real connection: the target's security group must allow the ALB, and the path must exist.
- If **all** targets are unhealthy, the ALB "fails open" and routes to all of them anyway; if there are no registered targets, clients get 503.

## Numbers that matter
- Detection time with defaults: 30 s × 2 = 60 s. Recovery: 30 s × 5 = 150 s.

## Common exam traps
- Health check path `/health` but the app serves `/healthz` → every target unhealthy.
- Auto Scaling only replaces instances that fail **ELB** health checks if the group's health check type is `ELB`; with `EC2` it only notices instance failures.

## Related
[[alb]] · [[asg-scaling]] · [[static-stability]]
