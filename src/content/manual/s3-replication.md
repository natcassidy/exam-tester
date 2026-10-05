# S3 replication (CRR / SRR)

## What it is
Asynchronous copying of new objects from one bucket to another: **Cross-Region Replication** (CRR) or **Same-Region Replication** (SRR), to the same or another account.

## How it actually works
- Requires versioning on both buckets and an IAM role for S3.
- Only new objects replicate; use S3 Batch Replication for existing ones.
- Delete markers replicate only if delete marker replication is on; deletes of specific versions never replicate (protects against malicious deletes).
- The destination can use a different storage class and owner (cross-account, with owner override).
- **Replication Time Control** (RTC): 99.99% of objects within 15 minutes, with metrics.

## Numbers that matter
- Cost: storage in the destination + replication requests + inter-Region transfer for CRR.

## Common exam traps
- "Copy to another Region for DR / compliance / lower latency" → CRR.
- "Aggregate logs from many buckets in one Region" → SRR.
- "Replicate within 15 minutes, guaranteed" → RTC.
- Replication is not a backup against accidental deletes if delete markers replicate.

## Related
[[s3-versioning]] · [[s3-object-lock]] · [[dr-strategies]] · [[aws-organizations]]
