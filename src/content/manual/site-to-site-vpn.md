# AWS Site-to-Site VPN

## What it is
An IPsec connection over the internet between an on-premises **customer gateway** (your router) and a **virtual private gateway** (one VPC) or a **transit gateway** (many).

## How it actually works
- Every connection has **two tunnels** to different AWS endpoints; configure both for redundancy.
- Routing is static or dynamic (BGP). VPC route tables need a route to the on-premises CIDR via the VGW (or route propagation).
- Encrypted by design. Throughput is bounded by the internet path: up to ~1.25 Gbps per tunnel; ECMP across tunnels needs a transit gateway.
- Can be set up in minutes, which makes it the day-one connection and the backup for Direct Connect.

## Numbers that matter
- ≈ $0.05 per connection-hour plus data out. Ready in minutes.

## Common exam traps
- "Connect on-premises quickly / within a day" → Site-to-Site VPN.
- "Consistent bandwidth or latency" → not VPN: [[direct-connect]].
- "Low-cost backup for Direct Connect" → VPN on the same gateway.
- Client VPN is for individual users' laptops, not sites.

## Related
[[direct-connect]] · [[hybrid-connectivity]] · [[transit-gateway]] · [[route-blackholes]]
