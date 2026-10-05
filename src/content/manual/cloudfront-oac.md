# CloudFront Origin Access Control (OAC)

## What it is
The way CloudFront authenticates to a private S3 origin. CloudFront signs every origin request with SigV4 as the `cloudfront.amazonaws.com` service principal, and the bucket policy allows only that principal, for that distribution.

## How it actually works
1. Create an OAC and attach it to the S3 origin of the distribution.
2. Bucket policy: allow `s3:GetObject` to `cloudfront.amazonaws.com` with `Condition: StringEquals AWS:SourceArn = arn:aws:cloudfront::<acct>:distribution/<id>`.
3. Keep Block Public Access on. Direct requests to the bucket URL get 403.

| | OAC | OAI (legacy) | Public bucket |
|---|---|---|---|
| Bucket can stay private | Yes | Yes | No |
| SSE-KMS objects | Supported | Not supported | n/a |
| All Regions / new features | Yes | Limited | n/a |
| Recommended | **Yes** | Migrate away | No |

## Numbers that matter
- Origin fetches from S3 to CloudFront: no data transfer charge.

## Common exam traps
- "Users must only access content through CloudFront" → OAC + bucket policy, **not** signed URLs (those restrict *which users*, not *which path*).
- OAC requires the S3 REST endpoint as origin, not the S3 static website endpoint (website endpoints only accept anonymous requests).

## Related
[[s3-bucket-policy]] · [[cloudfront-edge]] · [[s3-block-public-access]]
