# NAT gateway data processing charges

## What it is
Besides its hourly price, a NAT gateway charges for **every GB it processes**, in both directions, whatever the destination.

## How it actually works
- Traffic from a private subnet to S3, DynamoDB or any other public AWS endpoint goes through the NAT unless a more specific route (an endpoint) sends it elsewhere.
- The charge applies even though the data never leaves the Region and even though inbound internet transfer is otherwise free.
- Cross-AZ: if a private subnet uses a NAT in another AZ, you also pay cross-AZ transfer.

## Numbers that matter
- ≈ $0.045/GB processed + $0.045/hour per NAT (us-east-1).
- 20 TB/month from S3 through a NAT ≈ 20,000 × $0.045 = **$900/month**. Through a gateway endpoint: $0.

## Common exam traps
- "Large NAT gateway charges, instances read from S3" → S3 gateway endpoint on every private route table.
- Don't remove the NAT if instances still need the internet (patches); add the endpoint alongside it.

## Related
[[vpc-gateway-endpoints]] · [[data-transfer-costs]] · [[nat-gateway]]
