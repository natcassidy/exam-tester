# Cross-AZ traffic and AZ affinity

## What it is
Data that crosses Availability Zones inside a Region costs about **$0.01/GB in each direction**. In chatty architectures it quietly becomes a top line item.

## How it actually works
- Billed when an EC2 instance, container or Lambda in a VPC talks to a resource in another AZ: another instance, a NAT gateway, an RDS instance, an ElastiCache node.
- **NAT gateways are zonal.** A private subnet that routes to a NAT in another AZ pays cross-AZ transfer *and* NAT processing ($0.045/GB) on every byte, and loses the internet when that AZ fails.
- **Gateway endpoints** (S3, DynamoDB) are free and keep that traffic off the NAT completely.
- **AZ affinity:** route requests to a target in the same AZ where it is safe (one NAT per AZ, reading from a replica in the same AZ, AZ-aware service discovery). Keep enough capacity in every AZ that losing one doesn't take you down.
- Free: traffic within one AZ over private IPs; data between an ALB and its targets in other AZs (cross-zone load balancing is free on ALB); data into AWS from the internet.
- Caching (ElastiCache, CloudFront) cuts repeated fetches across AZs and to origin.

## Numbers that matter
- Cross-AZ ≈ $0.01/GB each way (so $0.02/GB for a round trip of data). NAT processing ≈ $0.045/GB.
- 20 TB/month from S3 through a NAT in another AZ ≈ $900 processing + $400 cross-AZ.

## Common exam traps
- "Reduce data transfer charges between EC2 and S3 in the same Region" → S3 gateway endpoint.
- "NAT gateway in one AZ for all private subnets" → one NAT per AZ: both cheaper (no cross-AZ) and resilient.
- Don't collapse everything into one AZ to save transfer: that breaks availability requirements.

## Related
[[nat-data-processing]] · [[vpc-gateway-endpoints]] · [[data-transfer-costs]] · [[nat-gateway]]
