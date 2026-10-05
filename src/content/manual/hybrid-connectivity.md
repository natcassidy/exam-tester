# Hybrid connectivity patterns

## What it is
How an on-premises network reaches VPCs: which link, which gateway, and which routes on each side.

## How it actually works
- **Link**: Site-to-Site VPN (minutes, over the internet, encrypted) or Direct Connect (weeks, dedicated, not encrypted by default).
- **Gateway**: a virtual private gateway serves **one VPC**; a transit gateway serves **many** VPCs and VPNs. A VPC never forwards VPN or DX traffic on to another VPC.
- **Routes**: on-premises routes to the VPC CIDR; the VPC route table routes the on-premises CIDR back to the VGW/TGW. Missing return routes are the classic failure.
- **Resilience**: DX primary + VPN backup (cheap) or two DX at two locations (maximum).

## Numbers that matter
- 80 TB over 100 Mbps ≈ 74 days; over 1 Gbps ≈ 7.4 days. Do the arithmetic before choosing a network transfer.

## Common exam traps
- Choosing Direct Connect for a deadline measured in days.
- Expecting peered VPCs to share a VPN.
- Forgetting that DX is not encrypted.

## Related
[[site-to-site-vpn]] · [[direct-connect]] · [[transit-gateway]] · [[vpc-peering]] · [[data-migration]]
