# RDS read replicas

## What it is
Asynchronously replicated copies of an RDS database that serve read-only queries.

## How it actually works
- The primary streams changes to replicas; lag is usually seconds but can grow under heavy writes.
- Up to 15 replicas (MySQL, MariaDB, PostgreSQL), in the same AZ, another AZ or another Region.
- Applications must send reads to replica endpoints explicitly.
- A replica can be **promoted** to a standalone database (manual, breaks replication).

## Numbers that matter
- Each replica costs like an instance of its class. Cross-Region replicas add data transfer.

## Common exam traps
- "Reporting queries slow down the production database" → read replica.
- Replicas do not provide automatic failover with zero data loss; that is Multi-AZ.
- Automated backups must be enabled on the source.

## Related
[[rds-multi-az]] · [[rds-backups]]
