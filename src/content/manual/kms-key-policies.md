# KMS key policies

## What it is
Every KMS key has a **key policy**, a resource-based policy that is the primary control for the key. Unlike most AWS resources, IAM policies alone can never grant access to a KMS key.

## How it actually works
- The default key policy contains a statement allowing the account root (`arn:aws:iam::ACCOUNT:root`) `kms:*`. That statement doesn't let the root user in by itself; it **enables IAM policies** to grant access to the key.
- Remove that statement and only principals named in the key policy can use the key, whatever their IAM policies say.
- S3 with SSE-KMS calls KMS **as the caller**: reading needs `kms:Decrypt`; writing needs `kms:GenerateDataKey`. Listing objects needs neither.
- The AWS managed key `aws/s3` allows any principal in the account to use it through S3; you can't edit its policy. Customer managed keys give you the policy, rotation, and cross-account use.
- Every KMS API call is logged in CloudTrail (management events).

## Numbers that matter
- Key policy size: 32 KB. Automatic rotation: yearly by default (configurable 90-2,560 days).
- SSE-KMS requests count against KMS request quotas (thousands per second, Region-dependent); S3 Bucket Keys cut those calls dramatically.

## Common exam traps
- "Role has s3:* but GetObject returns AccessDenied, ListBucket works" → SSE-KMS key policy.
- Cross-account access to encrypted objects needs the key policy to allow the other account too.
- Switching to SSE-S3 to "fix" access throws away the control the CMK was there for.

## Related
[[encryption-at-rest]] · [[resource-vs-identity-policies]] · [[iam-policy-evaluation]] · [[cloudtrail]]
