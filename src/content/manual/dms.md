# AWS Database Migration Service

## What it is
A managed service that migrates databases to AWS while the source stays online: **full load** plus **change data capture (CDC)**.

## How it actually works
- A replication instance connects to source and target endpoints (needs network reach to on-premises: VPN or DX).
- Full load copies existing data; CDC then streams ongoing changes until you cut over, so downtime is minutes.
- Homogeneous migrations (Oracle → Oracle, MySQL → Aurora MySQL) need no conversion. Heterogeneous ones (Oracle → PostgreSQL) need the **Schema Conversion Tool** (SCT) or DMS Schema Conversion for the schema and code.
- Also used for continuous replication into data lakes or between Regions.

## Numbers that matter
- Billed per replication-instance hour (or DMS Serverless capacity).

## Common exam traps
- "Migrate with minimal downtime" → DMS with full load + CDC.
- "Different database engines" → SCT + DMS.
- Full load only means writes must stop during the copy.

## Related
[[data-migration]] · [[aurora]] · [[site-to-site-vpn]] · [[snow-family]]
