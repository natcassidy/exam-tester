# Network ACLs

## What it is
A stateless, ordered firewall at the subnet boundary. Each subnet has exactly one NACL; one NACL can serve many subnets.

## How it actually works
- Rules are numbered 1-32766 and evaluated **lowest first; first match wins**. A final `*` rule denies everything else.
- **Stateless**: the response is a separate packet that must be allowed by its own rule. Clients send from an **ephemeral port** (1024-65535), so return traffic needs rules for that range.
- Traffic between instances in the same subnet does not cross the NACL.
- The default NACL allows everything both ways. A **new custom NACL denies everything** until you add rules.

Example for a web tier allowing HTTPS in:

| Direction | Rule | Port | Source/Dest | Action |
|---|---|---|---|---|
| Inbound | 100 | 443 | 0.0.0.0/0 | Allow |
| Outbound | 100 | 1024-65535 | 0.0.0.0/0 | Allow (responses) |

## Numbers that matter
- Ephemeral ports: 1024-65535 to be safe (Linux uses 32768-60999, Windows 49152-65535, ELB/NAT use 1024-65535).
- 20 rules per direction by default.

## Common exam traps
- "Allows inbound 443 but the site still times out" → missing outbound ephemeral rule.
- Number deny rules lower than broad allows, or they never match.

## Related
[[security-groups]] · [[vpc-public-private]]
