# AWS WAF

## What it is
A layer-7 web application firewall. A **web ACL** of rules inspects HTTP requests to CloudFront, ALB, API Gateway, AppSync, Cognito or App Runner and allows, blocks or counts them.

## How it actually works
- **Managed rule groups** (AWS and Marketplace): Core rule set (OWASP top 10), SQL injection, known bad inputs, IP reputation, bot control.
- **Rate-based rules**: block an IP that exceeds N requests in a 5-minute window.
- Custom rules: IP sets, geo match, header/body/URI matching.
- Associate the web ACL with the resource; CloudFront web ACLs are global (created in us-east-1).

| Need | Service |
|---|---|
| SQL injection, XSS, bad bots, rate limiting | AWS WAF |
| Network/transport DDoS (SYN floods) | AWS Shield (Standard is free and automatic) |
| Block a CIDR at the subnet | Network ACL |

## Numbers that matter
- ≈ $5 per web ACL/month + $1 per rule/month + $0.60 per million requests.

## Common exam traps
- WAF cannot attach to an NLB or directly to EC2.
- "Protect against SQL injection" → WAF, not security groups or Shield.

## Related
[[alb]] · [[cloudfront-edge]]
