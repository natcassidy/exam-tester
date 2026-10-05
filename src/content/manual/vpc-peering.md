# VPC peering

## What it is
A private, one-to-one connection between two VPCs (same or different account, same or different Region). Traffic stays on the AWS network.

## How it actually works
- Both sides must add **routes** to the other VPC's CIDR via the peering connection, and security groups must allow the traffic.
- **Not transitive**: if A peers with B and B with C, A cannot reach C through B.
- **No edge-to-edge routing**: A can't use B's internet gateway, NAT gateway, VPN, Direct Connect or gateway endpoint.
- CIDRs must not overlap. Security groups can reference SGs in a peered VPC in the same Region.

## Numbers that matter
- No hourly charge; data across AZs or Regions is billed at transfer rates. Full mesh of n VPCs = n(n-1)/2 connections.

## Common exam traps
- "Connect dozens or hundreds of VPCs, plus on-premises" → [[transit-gateway]], not peering.
- Overlapping CIDRs can't be peered.
- A peered VPC can't reach on-premises over the other VPC's VPN.

## Related
[[transit-gateway]] · [[route-blackholes]] · [[security-groups]] · [[hybrid-connectivity]]
