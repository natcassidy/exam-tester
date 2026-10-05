# RDS cross-Region read replicas

## What it is
An asynchronous read replica of an RDS database in another Region. It serves reads there and can be **promoted** to a standalone primary in a disaster.

## How it actually works
- Requires automated backups (retention ≥ 1 day) on the source; same engine.
- Replication is asynchronous, so promotion loses whatever had not replicated yet (seconds to minutes of lag).
- Promotion is manual (or scripted) and breaks replication; the new primary has its own endpoint, so the application or DNS must be pointed at it.
- Cross-Region replication traffic is billed as inter-Region data transfer.

## Numbers that matter
- In the game: promotion ≈ 5 min, lag ≈ 60 s. Up to 15 read replicas for MySQL/MariaDB/PostgreSQL.

## Common exam traps
- A same-Region replica does nothing for a Region outage.
- Replicas are for reads and DR, not for automatic HA: that is [[rds-multi-az]].
- For RPO of about a second and promotion in about a minute, the answer is [[aurora-global]].

## Related
[[rds-read-replicas]] · [[dr-strategies]] · [[aurora-global]] · [[rds-backups]]
