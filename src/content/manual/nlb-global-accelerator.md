# NLB, Gateway Load Balancer and Global Accelerator

## What it is
The other load balancers, and AWS's global network front door.

## How it actually works
- **Network Load Balancer (layer 4):** TCP/UDP/TLS, millions of requests per second with ultra-low latency, **one static IP per AZ** (or your Elastic IPs), preserves the client IP. Can front PrivateLink services.
- **Application Load Balancer (layer 7):** HTTP/HTTPS routing by path, host and header, WebSockets, gRPC, authentication with Cognito/OIDC, WAF.
- **Gateway Load Balancer:** inserts third-party virtual appliances (firewalls, IDS) transparently using GENEVE on port 6081.
- **AWS Global Accelerator:** two **static anycast IPs** that bring users onto the AWS backbone at the nearest edge location and send them to the closest healthy Regional endpoint (ALB, NLB, EC2, Elastic IP). Health-based failover in seconds, no DNS caching problem. Good for TCP/UDP, gaming, VoIP, and when clients need fixed IPs.
- CloudFront caches HTTP content at the edge; Global Accelerator doesn't cache, it accelerates any TCP/UDP traffic.

## Common exam traps
- "Static IP addresses for the load balancer / allow-list by IP" → NLB (Elastic IPs) or Global Accelerator.
- "UDP", "millions of requests per second", "extreme performance" → NLB.
- "Global users, non-HTTP, fast regional failover without DNS TTLs" → Global Accelerator.
- "Inspect all traffic with third-party firewall appliances" → Gateway Load Balancer.
- WAF attaches to ALB, CloudFront, API Gateway, not to NLB.

## Related
[[alb]] · [[cloudfront-edge]] · [[route53-routing-policies]]
