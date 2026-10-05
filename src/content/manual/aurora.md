# Amazon Aurora

## What it is
AWS's MySQL- and PostgreSQL-compatible database with a distributed storage layer. Up to ~5× MySQL / 3× PostgreSQL throughput on the same hardware, per AWS.

## How it actually works
- One **cluster volume** stores 6 copies across 3 AZs. Compute (writer + up to 15 Aurora Replicas) is separate from storage.
- Aurora Replicas share the storage, so replica lag is usually under 100 ms and any replica can be promoted in ~30 s.
- The cluster has a **writer endpoint** and a **reader endpoint** (load-balanced across replicas); custom endpoints group specific instances.
- Storage grows automatically up to 128 TiB. Backups are continuous; retention 1-35 days (cannot be turned off).
- **Aurora Serverless v2** scales capacity in fine steps (ACUs) for spiky or unpredictable load.

## Numbers that matter
- Failover with a replica ≈ 30 s; without a replica, Aurora must create a new instance (≈ 10 min).

## Common exam traps
- "Highly available MySQL with the fastest failover and many read replicas" → Aurora.
- "Unpredictable, intermittent database load" → Aurora Serverless v2.
- Aurora Replicas are in the same Region; cross-Region needs [[aurora-global]].

## Related
[[aurora-global]] · [[rds-multi-az]] · [[rds-read-replicas]] · [[dms]]
