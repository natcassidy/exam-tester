# AWS Direct Connect

## What it is
A dedicated private network connection from your data centre (via a Direct Connect location) to AWS. Consistent bandwidth and latency, lower data-out price.

## How it actually works
- **Dedicated** connections: 1, 10, 100 Gbps ports. **Hosted** connections from partners: 50 Mbps to 10 Gbps.
- Virtual interfaces: private VIF (to a VGW or Direct Connect gateway), transit VIF (to a transit gateway), public VIF (AWS public endpoints).
- **Not encrypted** by default. Encrypt with an IPsec VPN over DX, or MACsec on 10/100 Gbps dedicated connections.
- When both DX and VPN advertise the same prefix, AWS prefers DX; the VPN takes over when DX fails.
- Ordering a new connection takes **weeks**.

## Numbers that matter
- Port-hours (≈ $0.30/h for 1 Gbps) + lower data-out (≈ $0.02/GB). Lead time: weeks to months.

## Common exam traps
- "Needed tomorrow" → not Direct Connect.
- "Encrypted and consistent" → VPN over DX (or MACsec).
- Maximum resiliency → two DX connections at two locations.
- Direct Connect gateway: one DX to VPCs in many Regions.

## Related
[[site-to-site-vpn]] · [[hybrid-connectivity]] · [[transit-gateway]] · [[data-migration]]
