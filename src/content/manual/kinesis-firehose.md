# Amazon Data Firehose

## What it is
A fully managed delivery stream (formerly Kinesis Data Firehose) that batches streaming data into S3, Redshift, OpenSearch, Splunk and HTTP endpoints. No consumers to write.

## How it actually works
- Sources: Direct PUT from producers, or a Kinesis data stream.
- Buffers by size (1-128 MiB) **or** time (0-900 s), whichever comes first, then writes a batch. Near real time, not real time.
- Can transform records with Lambda and convert JSON to **Parquet/ORC** (using a Glue table schema), and compress.
- Scales automatically; no shards, no replay.

## Numbers that matter
- Billed per GB ingested in 5 KB increments, plus format conversion per GB. Parquet conversion needs a buffer of at least 64 MiB.

## Common exam traps
- "Near real-time delivery to S3 with the least operational overhead" → Firehose.
- "Real-time processing by custom consumers" → [[kinesis-data-streams]].
- Firehose can't replay and has no ordering guarantees for consumers.

## Related
[[kinesis-data-streams]] · [[athena-glue]] · [[s3-storage-classes]]
