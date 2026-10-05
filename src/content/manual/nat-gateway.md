# NAT gateways

## What it is
A managed service that lets instances in private subnets start connections to the internet while staying unreachable from it.

## How it actually works
- Lives in **one subnet in one AZ**, with an Elastic IP. That subnet must be public (route to an IGW).
- Private route tables send `0.0.0.0/0 → nat-…`.
- Return traffic for connections the instances opened is allowed back; unsolicited inbound is not.
- The NAT subnet's NACL applies to traffic in both directions through it.

| | NAT gateway | NAT instance |
|---|---|---|
| Managed / HA within AZ | Yes | You run it |
| Bandwidth | Scales to 100 Gbps | Instance size |
| Security groups | No | Yes |
| Cost | Hourly + per GB | Instance hours |

## Numbers that matter
- ≈ $0.045/hour + $0.045/GB processed (us-east-1), in either direction.
- Scales from 5 Gbps up to 100 Gbps automatically.

## Common exam traps
- **AZ-scoped**: one NAT for all AZs is a single point of failure and adds cross-AZ charges. Use one per AZ, each AZ's route table pointing at its own.
- S3 and DynamoDB traffic through a NAT pays per GB; use gateway endpoints instead.
- A NAT gateway in a private subnet cannot reach the internet.

## Related
[[nat-data-processing]] · [[vpc-gateway-endpoints]] · [[vpc-public-private]]
