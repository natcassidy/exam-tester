# Identity-based vs. resource-based policies

## What it is
Two places permission can live. **Identity-based** policies attach to a user, group or role and say what *it* can do. **Resource-based** policies attach to a resource (S3 bucket, SQS queue, KMS key, Lambda function, role trust policy) and say *who* can use it.

## How it actually works
- Identity policies have no `Principal`: the principal is whoever the policy is attached to.
- Resource policies must have a `Principal`: an account, a role/user ARN, a service (`cloudfront.amazonaws.com`) or `*`.
- **Same account**: either side's Allow is enough (if the resource policy names the principal).
- Naming only the **account** (`arn:aws:iam::111122223333:root`) in a resource policy delegates to IAM: the caller still needs an identity-based Allow.
- **Cross account**: both sides must allow.
- KMS key policies and role trust policies are special: they are **required**. IAM policies only count if the key/trust policy delegates to the account.

| | Identity-based | Resource-based |
|---|---|---|
| Attached to | User, group, role | Bucket, queue, key, function, role (trust) |
| Principal element | None | Required |
| Cross-account | Needs the other side | Needs the other side |
| Typical use | "What this app can do" | "Who may use this bucket" |

## Numbers that matter
- S3 bucket policy: up to 20 KB. SQS queue policy: 8 KB.

## Common exam traps
- "Grant another account access to a bucket": bucket policy naming that account **plus** an IAM policy in their account.
- Service principals (CloudFront, EventBridge, SNS) can only be granted access through a resource policy.

## Related
[[iam-policy-evaluation]] · [[s3-bucket-policy]] · [[kms-key-policies]] · [[iam-roles]]
