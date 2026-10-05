# Route tables and blackhole routes

## What it is
Each subnet uses exactly one route table; the most specific matching route (longest prefix) decides where a packet goes. A route whose target no longer exists is a **blackhole**: matching packets are silently dropped.

## How it actually works
- Deleting a NAT gateway, internet gateway attachment, peering connection or ENI leaves its routes behind with state `blackhole`. AWS does not remove them or fall back to another route.
- Only subnets associated with that route table are affected, which is why the symptom often hits one AZ.
- Fix: point the route at a working target in the **same AZ** (create a new NAT gateway), or replace it. Routing private subnets in AZ-a through a NAT in AZ-b works until AZ-b fails, and it adds cross-AZ data charges.

## Numbers that matter
- Route tables: 50 routes per table by default. The local route can't be removed.

## Common exam traps
- "Instances in one AZ lost internet access" → check that AZ's route table for a blackhole NAT route.
- "Who deleted it?" → CloudTrail.

## Related
[[nat-gateway]] · [[vpc-public-private]] · [[cloudtrail]]
