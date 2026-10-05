# Internet gateways

## What it is
A horizontally scaled, highly available VPC attachment that connects the VPC to the internet. It performs 1:1 NAT between an instance's private IP and its public IPv4 address.

## How it actually works
- One IGW per VPC. Attach it, then add `0.0.0.0/0 → igw` to the route tables of public subnets.
- Outbound: an instance needs a public IP or Elastic IP; the IGW swaps the source address.
- Inbound: traffic reaches only interfaces with public addresses (or a load balancer's public nodes).
- No bandwidth limit, no availability risk, no charge for the gateway itself.

## Numbers that matter
- 1 IGW per VPC. $0 per hour, $0 per GB (you pay data transfer out, not the IGW).

## Common exam traps
- An IGW alone does not make an instance reachable: it also needs a public IP, a route and permissive SG/NACL rules.
- Private instances cannot use an IGW directly; that is what a NAT gateway is for.
- Egress-only internet gateway = the IPv6 equivalent of NAT (outbound only).

## Related
[[vpc-public-private]] · [[nat-gateway]]
