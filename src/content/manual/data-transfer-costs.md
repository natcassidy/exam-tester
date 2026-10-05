# Data transfer pricing

## What it is
AWS charges for data moving out of AWS and between some locations inside it. Where your bytes flow often matters more than where they are stored.

## How it actually works
| Path | Approx. price (us-east-1) |
|---|---|
| Internet → AWS (inbound) | Free |
| AWS → internet (first 10 TB/month tier) | ≈ $0.09/GB (100 GB/month free) |
| CloudFront → internet (North America) | ≈ $0.085/GB |
| Origin (S3/ALB) → CloudFront | Free |
| Same AZ, private IP | Free |
| Between AZs | ≈ $0.01/GB each direction |
| Between Regions | ≈ $0.02/GB |
| Through a NAT gateway | + $0.045/GB processing |
| Through a gateway endpoint | Free |

## Numbers that matter
- Public IPv4 addresses ≈ $0.005/hour each (≈ $3.65/month).

## Common exam traps
- Serving downloads directly from S3/EC2 → put CloudFront in front.
- Chatty cross-AZ traffic adds up; keep traffic in-AZ where it is safe.
- "Most cost-effective way for private instances to use S3" → gateway endpoint.

## Related
[[nat-data-processing]] · [[cloudfront-edge]] · [[vpc-gateway-endpoints]]
