# CloudFront edge caching

## What it is
A global content delivery network. Viewers connect to the nearest of hundreds of edge locations; cached responses are served there, and misses travel to your origin over the AWS backbone.

## How it actually works
- DNS sends each viewer to a nearby edge (latency-based).
- TLS terminates at the edge, so the slow handshakes happen over a short distance.
- **Cache hit**: answered at the edge (~5-20 ms). **Miss**: edge → regional edge cache → origin.
- Cache behaviour is controlled by cache policies (TTL, which headers/cookies/query strings form the key).
- Viewer protocol policy: `allow-all`, `redirect-to-https`, `https-only`.

## Numbers that matter
- Sydney → us-east-1 round trip ≈ 200 ms; Sydney → Sydney edge ≈ 10 ms.
- Data out from CloudFront ≈ $0.085/GB (North America/Europe first tier), cheaper than S3/EC2 internet egress (≈ $0.09/GB). Origin → CloudFront transfer is free.
- Default TTL 24 h when the origin sends no Cache-Control.

## Common exam traps
- Static content + global users → CloudFront, not cross-Region replication.
- S3 Transfer Acceleration speeds up uploads; it does not cache.
- Dynamic APIs can still benefit (TLS at the edge, backbone routing) even with caching off.

## Related
[[cloudfront-oac]] · [[route53-alias]] · [[data-transfer-costs]]
