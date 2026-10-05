# Auto Scaling health checks

## What it is
How an Auto Scaling group decides an instance is unhealthy and must be **terminated and replaced**.

## How it actually works
- **EC2** (the default): uses EC2 status checks only (hardware, hypervisor, OS networking). A crashed application on a healthy OS is invisible: the instance stays InService forever.
- **ELB**: the group also replaces instances that fail the load balancer's target health checks. Use this whenever the group is behind a load balancer.
- **Health check grace period** (default 300 s): ELB health checks are ignored for a new instance until it has had time to boot and start the app. Too short → new instances are killed before they're ready, in a loop.
- The load balancer and the Auto Scaling group are separate: the ALB stops routing to an unhealthy target, but only the ASG replaces it.

| Health check type | Sees | Misses |
|---|---|---|
| EC2 | Stopped/impaired instances | Dead app, wrong port, wrong health path |
| ELB | All of the above + failing target health checks | Nothing the health check path covers |

## Numbers that matter
- Grace period default 300 s; set it above boot + app start time.

## Common exam traps
- "Unhealthy instances behind the ALB are never replaced" → switch the group to ELB health checks.
- A wrong health check path + ELB health checks = endless replacement churn.

## Related
[[alb-health-checks]] · [[asg-scaling]] · [[alb-error-codes]]
