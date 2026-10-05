# S3 Block Public Access

## What it is
Four account- or bucket-level switches that override any policy or ACL that would make S3 data public. They are a safety net above every individual bucket policy.

## How it actually works
- **BlockPublicAcls**: rejects PUT calls that add public ACLs.
- **IgnorePublicAcls**: ignores public ACLs that already exist.
- **BlockPublicPolicy**: rejects bucket policies that grant public access.
- **RestrictPublicBuckets**: limits access to buckets with public policies to AWS service principals and the bucket owner's account.

Set at the **account** level, they apply to every bucket, existing and future. New buckets have all four on by default (since April 2023).

## Numbers that matter
- 4 settings, 2 levels (account, bucket). The most restrictive combination wins.
- New buckets: Block Public Access on, ACLs disabled (Object Ownership = bucket owner enforced).

## Common exam traps
- "Prevent any bucket from ever being public" → **account-level** Block Public Access, not per-bucket policies or AWS Config alerts (detection is not prevention).
- Encryption does **not** stop public reads: S3 decrypts for anyone allowed to read.
- CloudFront with **OAC** works with Block Public Access fully on, because the service principal is not "public".

## Related
[[s3-bucket-policy]] · [[cloudfront-oac]] · [[encryption-at-rest]]
