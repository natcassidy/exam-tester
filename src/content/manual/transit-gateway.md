# AWS Transit Gateway

## What it is
A regional hub router that connects VPCs, VPNs and Direct Connect gateways in a hub-and-spoke model, replacing peering meshes.

## How it actually works
- Each VPC, VPN or DX gateway is an **attachment**. VPC route tables send traffic to the TGW; the TGW forwards using **TGW route tables**.
- Each attachment is **associated** with exactly one TGW route table (where its traffic is looked up) and can **propagate** its CIDRs into any number of them.
- Segmentation: put prod and dev in different route tables and only propagate what each may reach. A blackhole route drops traffic on purpose.
- Routing is transitive through the TGW (unlike peering). Share it with other accounts through **AWS RAM**.
- Inter-Region: peer TGWs across Regions.

## Numbers that matter
- ≈ $0.05 per attachment-hour + $0.02 per GB processed. Up to 5,000 attachments.

## Common exam traps
- "Simplify connectivity between many VPCs and on-premises" → Transit Gateway.
- "Isolate dev from prod but both reach shared services" → separate TGW route tables.
- Return routes: both VPCs and both TGW route tables need a path.

## Related
[[vpc-peering]] · [[site-to-site-vpn]] · [[direct-connect]] · [[aws-organizations]] · [[hybrid-connectivity]]
