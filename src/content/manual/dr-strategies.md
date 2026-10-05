# DR strategies: backup and restore to multi-site

## What it is
Four standard ways to recover a workload in another Region, ordered by cost and by how fast they recover. You pick the cheapest one that meets the **RTO** (how long you can be down) and **RPO** (how much data you can lose).

## How it actually works
| Strategy | What runs in the DR Region | Data | Typical RTO | Typical RPO |
|---|---|---|---|---|
| Backup and restore | Nothing | Backups / snapshots copied there | Hours | Hours (backup interval) |
| Pilot light | Core data only (replica DB); app tier off or at zero | Continuous replication | Tens of minutes | Seconds to minutes |
| Warm standby | A scaled-down but working copy of everything | Continuous replication | Minutes | Seconds |
| Multi-site active/active | Full capacity, serving traffic | Continuous (often multi-writer) | Near zero | Near zero |

- RTO in the game is **DNS detection + TTL + the slowest of (data promotion or restore, compute start-up)**. Data and compute recover in parallel; DNS has to flip first.
- RPO comes only from how data reaches the DR Region: backup interval, replication lag, or zero.
- A "hot standby" (full-size but not serving until failover) is still warm standby on the exam.

## Numbers that matter
- In the game: launching a fleet from zero ≈ 10 min + warmup; promoting an RDS cross-Region replica ≈ 5 min with ~60 s of lag; Aurora Global Database promotion ≈ 1 min with ~1 s lag; restoring a snapshot ≈ 30-40 min.

## Common exam traps
- "Most cost-effective" + RPO of hours → backup and restore. RPO of minutes → at least pilot light.
- "Minimal downtime, cost is not a concern" → multi-site.
- Pilot light vs. warm standby: in pilot light the application servers are **off**; in warm standby they are **running**, just smaller.
- Multi-AZ is not DR for a Region outage.

## Related
[[rds-cross-region-replicas]] · [[aurora-global]] · [[dynamodb-global-tables]] · [[aws-backup]] · [[route53-routing-policies]] · [[rds-multi-az]]
