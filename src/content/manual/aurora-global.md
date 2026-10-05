# Aurora Global Database

## What it is
One primary Aurora cluster that replicates at the storage layer to up to 5 read-only secondary clusters in other Regions.

## How it actually works
- Replication happens in the storage layer, not through the database engine: typical lag **under 1 second**.
- A secondary can be promoted in about a minute (managed failover / switchover, or detach and promote).
- Secondaries serve local reads with low latency. Write forwarding can send writes from a secondary to the primary.

## Numbers that matter
- RPO ≈ 1 s, RTO ≈ 1 min. Up to 5 secondary Regions, 16 read replicas per secondary.

## Common exam traps
- "RPO of 1 second and RTO of 1 minute for a relational database across Regions" → Aurora Global Database.
- Cross-Region read replicas of RDS have more lag and slower promotion.
- It is not multi-writer: one Region takes writes.

## Related
[[aurora]] · [[dr-strategies]] · [[rds-cross-region-replicas]] · [[dynamodb-global-tables]]
