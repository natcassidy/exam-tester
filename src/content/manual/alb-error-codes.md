# ALB error codes (502 / 503 / 504)

## What it is
When an Application Load Balancer answers with a 5xx itself (ELB status code set, target status code "-"), the code tells you where the problem is.

## How it actually works

| Code | Meaning | Typical causes |
|---|---|---|
| **502 Bad Gateway** | The target sent a bad or no response | Target closed the connection, TLS errors to the target, malformed response, Lambda target error |
| **503 Service Unavailable** | No registered targets to send to | Empty target group, every target deregistered or being replaced |
| **504 Gateway Timeout** | The target didn't answer in time | Response dropped on the way back (NACL), target overloaded, app slower than the idle timeout |
| 500 / 4xx with target status | The app itself answered with an error | Application bug, DB unreachable |

- If **all** registered targets fail health checks, an ALB fails open and sends traffic to all of them. Users may still be served while the console says "0 healthy".
- Access logs: `target_processing_time -1` means no response came back from the target.

## Numbers that matter
- Idle timeout: 60 s default (1-4,000 s).

## Common exam traps
- 503 → look at target registration and health. 504 → look at the path back and target latency. 502 → look at the target's responses.

## Related
[[alb]] · [[alb-health-checks]] · [[asg-health-checks]]
