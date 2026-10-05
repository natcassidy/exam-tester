# AWS CloudTrail

## What it is
The record of API calls in your account: who did what, when, from where, and whether it was allowed. The answer to "who deleted the NAT gateway?".

## How it actually works
- **Management events** (create, delete, modify resources, IAM, KMS calls) are logged by default and visible in Event history for 90 days.
- **Data events** (S3 GetObject/PutObject, DynamoDB item reads/writes, Lambda Invoke) are high-volume and must be enabled explicitly on a trail or event data store.
- Each record shows `userIdentity` (for roles: `assumed-role/ROLE/SESSION`), `eventName`, `sourceIPAddress` (`s3.amazonaws.com` when a service called on your behalf), and `errorCode`/`errorMessage` such as AccessDenied.
- A trail delivers to S3 (optionally CloudWatch Logs) for long-term retention; enable log file validation and an organization trail.

## Numbers that matter
- Event history: 90 days of management events, free. First copy of management events in a trail is free.

## Common exam traps
- "Who changed the security group?" → CloudTrail. "What traffic was rejected?" → VPC Flow Logs. "What is the CPU doing?" → CloudWatch.
- S3 object-level activity is invisible unless data events are on.

## Related
[[vpc-flow-logs]] · [[cloudwatch-metrics]] · [[iam-policy-evaluation]]
