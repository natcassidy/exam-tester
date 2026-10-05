# VPC gateway endpoints

## What it is
A free VPC attachment that lets private subnets reach **S3 or DynamoDB** (only those two) over the AWS network, without an internet gateway or NAT.

## How it actually works
- You **associate** the endpoint with route tables. Each associated table gets a route: `pl-xxxx (S3 prefix list) → vpce-…`.
- The prefix list route is more specific than `0.0.0.0/0`, so longest-prefix match sends S3 traffic to the endpoint and everything else to the NAT.
- Route tables that are **not** associated keep sending S3 traffic through their default route.
- Endpoint policies (Stage 2) and bucket policies with `aws:SourceVpce` can restrict access further.

| | Gateway endpoint | Interface endpoint (PrivateLink) |
|---|---|---|
| Services | S3, DynamoDB | Most AWS services (and S3) |
| How | Route table entry | ENI with private IP in your subnets |
| Cost | Free | ≈ $0.01/hour per AZ + $0.01/GB |
| Reachable from on-prem / peered VPC | No | Yes |

## Common exam traps
- One route table associated, another not → half the traffic still pays NAT charges.
- "Access S3 from on-premises over Direct Connect privately" → interface endpoint, not gateway.

## Related
[[nat-data-processing]] · [[nat-gateway]]
