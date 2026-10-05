# Security groups vs. network ACLs

## What it is
The two firewalls inside a VPC. Security groups protect network interfaces; network ACLs protect subnet boundaries. Traffic between subnets passes both.

## How it actually works
A packet from instance A (subnet 1) to instance B (subnet 2) is checked: A's SG outbound → subnet 1 NACL outbound → subnet 2 NACL inbound → B's SG inbound. The response: B's SG lets it out automatically (stateful), but subnet 2's NACL outbound and subnet 1's NACL inbound must both allow the **ephemeral port** (stateless).

| | Security group | Network ACL |
|---|---|---|
| Level | Network interface | Subnet |
| State | Stateful | Stateless |
| Rules | Allow only | Allow and deny |
| Evaluation | All rules, union | Numbered, first match wins |
| Default | No inbound, all outbound | Default NACL allows all; new custom NACL denies all |
| Can reference | Other SGs, prefix lists | CIDRs only |

## Numbers that matter
- Ephemeral ports: allow 1024-65535 for return traffic.

## Common exam traps
- "Block a specific IP range" → NACL deny (SGs can't deny).
- "Requests arrive but responses time out after hardening" → NACL missing the ephemeral outbound rule.
- Same-subnet traffic never crosses a NACL.

## Related
[[security-groups]] · [[nacls]] · [[vpc-flow-logs]]
