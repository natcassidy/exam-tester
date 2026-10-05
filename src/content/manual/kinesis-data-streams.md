# Kinesis Data Streams

## What it is
A real-time stream of records that many consumers can read independently, in order per partition key, and replay.

## How it actually works
- Producers put records with a **partition key**; the key's hash picks the **shard**. Records are ordered within a shard.
- Each shard ingests **1 MB/s or 1,000 records/s** and serves **2 MB/s** of reads shared by all standard consumers.
- **Enhanced fan-out** gives each registered consumer its own 2 MB/s per shard, pushed with ~70 ms latency.
- Retention 24 hours by default, up to 365 days: consumers can rewind and reprocess.
- Capacity modes: provisioned (you choose shards) or on-demand (scales automatically, higher per-GB price).

## Numbers that matter
- Shards needed = max(MB/s ÷ 1, records/s ÷ 1,000). Exceeding it → ProvisionedThroughputExceededException.

## Common exam traps
- "Multiple applications consume the same stream in real time, in order, with replay" → Kinesis Data Streams, not SQS.
- "Load streaming data into S3 / Redshift with no code" → [[kinesis-firehose]].
- Several consumers falling behind → enhanced fan-out or more shards.

## Related
[[kinesis-firehose]] · [[messaging-fanout]] · [[athena-glue]] · [[lambda-concurrency]]
