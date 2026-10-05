# Security groups

## What it is
A stateful, allow-only virtual firewall attached to network interfaces (EC2, ALB, RDS, Lambda in a VPC, interface endpoints).

## How it actually works
- **Stateful**: if a request is allowed in, its response is allowed out automatically (and vice versa). Return traffic never needs a rule.
- **Allow only**: there are no deny rules. Anything not allowed is denied.
- All rules across all attached groups are evaluated together (union). No ordering.
- Sources/destinations: CIDR, another security group (matches any ENI carrying it), or a prefix list.
- A new group allows all outbound and no inbound.

| | Security group | Network ACL |
|---|---|---|
| Applies to | ENI (instance) | Subnet |
| State | Stateful | Stateless |
| Rules | Allow only | Allow and deny |
| Order | All evaluated | Lowest number first |
| Return traffic | Automatic | Needs ephemeral port rules |

## Numbers that matter
- Up to 5 security groups per ENI (adjustable), 60 inbound + 60 outbound rules per group by default.

## Common exam traps
- "Block one malicious IP" → NACL deny rule; security groups cannot deny.
- Referencing a security group is better than IPs for Auto Scaling tiers.

## Related
[[nacls]] · [[sg-chaining]]
