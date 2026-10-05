# Public vs. private subnets

## What it is
AWS has no "public" checkbox on a subnet. A subnet is **public** only because its route table sends `0.0.0.0/0` to an internet gateway. Otherwise it is private.

## How it actually works
- Public subnet: route `0.0.0.0/0 → igw-…`. Instances there still need a public IPv4 or Elastic IP to use it.
- Private subnet: no IGW route. Outbound internet goes via a NAT gateway (`0.0.0.0/0 → nat-…`) or not at all (isolated).
- Every route table has an implicit `local` route for the VPC CIDR, so all subnets can reach each other (subject to SGs and NACLs).

| Tier | Subnet | Why |
|---|---|---|
| Load balancer, NAT gateway | Public | Must be reachable from / reach the internet |
| App servers | Private | Only the load balancer talks to them |
| Databases | Private (isolated or NAT) | Never reachable from the internet |

## Numbers that matter
- AWS reserves 5 IPs per subnet (first four and the last). A /24 has 251 usable addresses.
- Public IPv4 addresses cost ≈ $0.005/hour each (since Feb 2024).

## Common exam traps
- Deleting the IGW route makes a "public" subnet private instantly.
- "RDS must not be accessible from the internet" → private subnets **and** Publicly accessible = No.

## Related
[[internet-gateway]] · [[nat-gateway]] · [[security-groups]]
