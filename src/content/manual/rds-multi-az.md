# RDS Multi-AZ

## What it is
RDS keeps a **synchronous standby** in another AZ and fails over to it automatically.

## How it actually works
- Every commit is written to the primary and the standby before it is acknowledged, so **RPO = 0**.
- On failure (instance, storage, AZ, or during patching), RDS promotes the standby and updates the DNS record of the endpoint. Applications reconnect to the same hostname.
- The standby (classic Multi-AZ instance) serves no reads. Multi-AZ **DB clusters** (two readable standbys) also exist for MySQL/PostgreSQL.

| | Multi-AZ standby | Read replica |
|---|---|---|
| Replication | Synchronous | Asynchronous |
| Purpose | High availability | Read scaling |
| Readable | No (instance deployment) | Yes |
| Failover | Automatic, same endpoint | Manual promotion, new endpoint |
| Cross-Region | No | Yes |

## Numbers that matter
- Failover typically 60-120 seconds. Cost roughly 2× Single-AZ (instance + storage).

## Common exam traps
- "High availability / automatic failover / no data loss" → Multi-AZ, not a read replica.
- Multi-AZ does not improve read performance.

## Related
[[rds-backups]] · [[rds-read-replicas]] · [[static-stability]]
