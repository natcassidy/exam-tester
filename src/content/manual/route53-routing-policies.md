# Route 53 routing policies and health checks

## What it is
How Route 53 picks which answer to return for a name. Combined with health checks, it is the switch that moves users between Regions.

## How it actually works
| Policy | Answers with | Typical use |
|---|---|---|
| Simple | One target (no health checks) | Single resource |
| Failover | Primary while healthy, else secondary | Active/passive DR |
| Weighted | Targets in proportion to weights | Canary, blue/green, A/B |
| Latency | The Region with the lowest latency for the resolver | Global apps, active/active |
| Geolocation | By the user's continent/country (plus a default) | Compliance, localisation |
| Geoproximity | By distance, shifted by a bias | Shifting traffic between Regions |
| Multivalue answer | Up to 8 healthy records | Simple client-side load spreading |

- A record only drops out when it has a **health check** (or Evaluate Target Health on an alias). Without one, Route 53 keeps answering with a dead target.
- Failover time = health check interval × failure threshold (30 s × 3 by default, 10 s fast checks) + the TTL resolvers cache the old answer. Alias records to a load balancer use a 60 s TTL.
- Geolocation without a default record returns no answer to users from unlisted locations.

## Numbers that matter
- Health checks ≈ $0.50/month each (AWS endpoints). Latency, geo and failover queries cost more than simple queries.

## Common exam traps
- "Route users to the Region with the lowest latency" → latency routing, not geolocation.
- "Users in Germany must only be served from eu-central-1" → geolocation.
- "Send 10% of traffic to the new version" → weighted.
- Multivalue answer is not a substitute for a load balancer.

## Related
[[route53-alias]] · [[dr-strategies]] · [[alb-health-checks]] · [[dynamodb-global-tables]]
