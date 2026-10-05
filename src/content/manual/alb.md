# Application Load Balancer

## What it is
A managed layer-7 (HTTP/HTTPS/gRPC) load balancer. It terminates client connections, applies listener rules (path, host, header) and forwards to target groups.

## How it actually works
- Enabled in **at least two subnets in two different AZs**; AWS places a node in each.
- **Two connections**: client → ALB node (listener, ALB security group), then a *new* connection ALB node → target (target security group must allow the ALB's group).
- Cross-zone load balancing is always on for ALBs (configurable per target group).
- Internet-facing ALBs need public subnets; targets can (and should) be private.

| | ALB | NLB |
|---|---|---|
| Layer | 7 (HTTP) | 4 (TCP/UDP/TLS) |
| Static IP / Elastic IP | No | Yes, one per AZ |
| Path/host routing | Yes | No |
| Security groups | Yes | Yes (since 2023) |

## Numbers that matter
- ≈ $0.0225/hour + $0.008 per LCU-hour. One LCU ≈ 25 new connections/s, 3,000 active connections, 1 GB/hour processed or 1,000 rule evaluations/s.

## Common exam traps
- "Needs a static IP for allow-listing" → NLB (or Global Accelerator), not ALB.
- 502 = target closed/reset the connection; 503 = no healthy targets; 504 = target timed out.

## Related
[[alb-health-checks]] · [[sg-chaining]] · [[asg-scaling]]
