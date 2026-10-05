# DynamoDB Accelerator (DAX)

## What it is
A managed, write-through in-memory cache in front of DynamoDB, API-compatible with DynamoDB. Microsecond reads.

## How it actually works
- The application uses the DAX client; reads of cached items never reach the table.
- Item cache (GetItem/BatchGetItem) and query cache (Query/Scan results).
- Runs as a cluster of nodes inside your VPC (one primary, read replicas across AZs).

## Numbers that matter
- One DynamoDB partition serves at most 3,000 RCU (≈ 6,000 eventually consistent 4 KB reads/s). A single hot item lives in one partition, so DAX is the fix for read-heavy hot keys.

## Common exam traps
- "Microsecond latency for DynamoDB reads with minimal code changes" → DAX, not ElastiCache.
- DAX doesn't help write-heavy workloads.
- Strongly consistent reads pass through to the table.

## Related
[[dynamodb-capacity]] · [[dynamodb-global-tables]] · [[cloudfront-edge]]
