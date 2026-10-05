# AWS Organizations, accounts and RAM

## What it is
Organizations groups accounts under one management account with consolidated billing and **service control policies**. AWS RAM shares resources (transit gateways, subnets, Route 53 Resolver rules) across accounts.

## How it actually works
- Accounts are the strongest isolation boundary: separate prod, dev, security, logging and backup accounts.
- SCPs set the maximum permissions for accounts in an OU; they grant nothing.
- **RAM** shares a transit gateway with other accounts so their VPCs can attach. Shared VPC subnets let several accounts launch into one VPC.
- Ransomware isolation: copies of data (S3 replication, AWS Backup copies) in a separate account the attacker's credentials can't reach.
- Control Tower sets up a governed multi-account landing zone.

## Numbers that matter
- Consolidated billing combines usage for volume discounts and shares Reserved Instance / Savings Plan benefits.

## Common exam traps
- "Share a transit gateway with other accounts" → AWS RAM.
- "Prevent any account in the OU from leaving a Region" → SCP.
- "Protect backups from a compromised admin" → copies in a separate account.

## Related
[[scps]] · [[transit-gateway]] · [[aws-backup]] · [[s3-replication]]
