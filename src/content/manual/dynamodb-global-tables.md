# DynamoDB global tables

## What it is
A DynamoDB table replicated to several Regions, where **every replica accepts reads and writes** (multi-active).

## How it actually works
- Writes replicate asynchronously to the other Regions, typically within a second. Conflicts are resolved with last-writer-wins.
- There is nothing to promote in a disaster: users are simply routed to another Region (Route 53 latency or failover routing).
- Requires DynamoDB Streams (enabled for you). Replicated writes are billed in each Region.

## Numbers that matter
- RPO ≈ 1 s, RTO = however long DNS takes to move users.

## Common exam traps
- "Low-latency reads **and writes** for users on several continents" → global tables.
- "Multi-Region, active-active, NoSQL" → global tables. Relational equivalent with a single writer → [[aurora-global]].
- Point-in-time recovery is per Region and protects against bad writes, not Region loss.

## Related
[[dax]] · [[route53-routing-policies]] · [[dynamodb-capacity]] · [[dr-strategies]]
