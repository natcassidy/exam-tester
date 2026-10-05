# S3 bucket policies

## What it is
A resource-based JSON policy attached to a bucket. It says which principals may perform which S3 actions on the bucket and its objects, under which conditions.

## How it actually works
- `Principal` names who: an account, a role, a service (`cloudfront.amazonaws.com`) or `*` (anyone).
- `Resource` uses ARNs: `arn:aws:s3:::bucket` for bucket actions (ListBucket), `arn:aws:s3:::bucket/*` for object actions (GetObject).
- `Condition` narrows it: `AWS:SourceArn` (which distribution), `aws:SourceVpce` (which endpoint), `aws:SecureTransport` (HTTPS only).
- Within one account, an allow in either the bucket policy **or** the IAM policy is enough (unless something denies). Cross-account needs both sides.

| Pattern | Grants to | Typical use |
|---|---|---|
| `"Principal": "*"` + GetObject | Anyone | Public website (blocked by Block Public Access) |
| `cloudfront.amazonaws.com` + `AWS:SourceArn` | One CloudFront distribution | Private origin behind CloudFront (OAC) |
| Deny unless `aws:SecureTransport` | Nobody over HTTP | Enforce TLS |

## Common exam traps
- Object actions need `bucket/*`; `bucket` alone only covers bucket-level actions.
- Block Public Access rejects a public policy outright when BlockPublicPolicy is on.

## Related
[[s3-block-public-access]] · [[cloudfront-oac]]
