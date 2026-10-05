# Route 53 alias records

## What it is
A Route 53 extension to DNS: an A/AAAA record that points at an AWS resource (CloudFront, ALB, S3 website, API Gateway, another record) and resolves to its current IPs.

## How it actually works
- Route 53 looks up the target's addresses at query time, so IP changes are followed automatically.
- Works at the **zone apex** (`example.com`), where a CNAME is not allowed.
- Queries to alias targets that are AWS resources are free.

| | Alias | CNAME |
|---|---|---|
| Zone apex | Yes | No |
| Targets | AWS resources only | Any hostname |
| Query charge | Free for AWS targets | Charged |
| TTL | Inherited from target | You set it |

## Numbers that matter
- Hosted zone ≈ $0.50/month; standard queries ≈ $0.40 per million.

## Common exam traps
- "Point the root domain at a load balancer / CloudFront" → alias record.
- Alias cannot point at an EC2 instance's IP; use an A record (or put it behind a load balancer).

## Related
[[cloudfront-edge]] · [[alb]]
