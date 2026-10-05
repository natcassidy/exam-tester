# Encryption at rest

## What it is
Data is encrypted where it is stored, using keys managed by AWS KMS (or the service). It protects against access to the underlying storage media, not against an authorised reader.

## How it actually works
| Service | Default | Notes |
|---|---|---|
| S3 | SSE-S3 on all new objects since Jan 2023 | SSE-KMS adds key policies and CloudTrail auditing of key use |
| RDS | Off unless chosen at creation | Can't enable in place: snapshot → copy encrypted → restore |
| DynamoDB | Always on (AWS owned key) | Choose AWS managed or customer managed KMS key for control |
| SQS | SSE-SQS on by default for new queues | Or SSE-KMS |
| EBS | Optional, can be default per Region | Snapshots inherit encryption |

## Numbers that matter
- KMS customer managed key ≈ $1/month + $0.03 per 10,000 requests.

## Common exam traps
- Encrypting an existing unencrypted RDS database requires a snapshot copy and restore.
- Read replicas of an encrypted DB are encrypted; you can't have an unencrypted replica of an encrypted primary.
- Encryption does not stop public access: S3 decrypts for anyone with permission.

## Related
[[s3-block-public-access]] · [[rds-backups]]
