# Choosing a migration method

## What it is
Picking how data gets to AWS from its size, the link, the deadline and whether it keeps changing.

## How it actually works
1. Compute network time: TB × 8,000,000 ÷ Mbps = seconds (at 100% utilisation). 80 TB at 100 Mbps ≈ 74 days; at 1 Gbps ≈ 7.4 days.
2. If that misses the deadline, ship it: [[snow-family]].
3. If the data keeps changing, sync the delta online after the bulk: [[datasync]].
4. Databases that must stay live: [[dms]] with CDC.
5. Faster internet uploads over long distances: S3 Transfer Acceleration. New dedicated links take weeks: [[direct-connect]].
6. Servers: AWS Application Migration Service (rehost / lift-and-shift).

## Numbers that matter
- Direct Connect lead time: weeks. VPN: minutes. Snowball round trip: about a week.

## Common exam traps
- Ordering Direct Connect to beat a deadline measured in days.
- Forgetting changes that happen while the Snowball is in transit.
- Using DMS full-load for a database that can't stop.

## Related
[[snow-family]] · [[datasync]] · [[dms]] · [[hybrid-connectivity]]
