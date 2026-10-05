# Shield, GuardDuty, Macie, Inspector, Secrets Manager

## What it is
Managed security services that show up across exam scenarios.

## How it actually works
| Service | Does |
|---|---|
| Shield Standard / Advanced | DDoS protection (Standard free; Advanced adds response team, cost protection) |
| GuardDuty | Threat detection from CloudTrail, VPC Flow Logs, DNS logs |
| Macie | Finds sensitive data (PII) in S3 |
| Inspector | Vulnerability scanning of EC2, container images, Lambda |
| Security Hub | Aggregates findings and checks against standards |
| Detective | Investigates the root cause of findings |
| Secrets Manager | Stores secrets with **automatic rotation** (e.g. RDS passwords) |
| Systems Manager Parameter Store | Configuration and secrets, no built-in rotation, cheaper |
| ACM | TLS certificates for load balancers and CloudFront |
| Cognito | User sign-up/sign-in for apps (user pools) and AWS credentials (identity pools) |

## Numbers that matter
- Secrets Manager ≈ $0.40 per secret-month; Parameter Store standard parameters are free.

## Common exam traps
- "Rotate database credentials automatically" → Secrets Manager.
- "Detect PII in S3" → Macie. "Detect compromised instances / unusual API calls" → GuardDuty.
- "Protect against large DDoS with expert support" → Shield Advanced (with WAF).

## Related
[[aws-waf]] · [[cloudtrail]] · [[vpc-flow-logs]] · [[kms-key-policies]]
