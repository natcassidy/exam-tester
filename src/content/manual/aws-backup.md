# AWS Backup

## What it is
A central service that schedules, retains and copies backups of many AWS services (EBS, RDS, Aurora, DynamoDB, EFS, FSx, S3, EC2 and more) from backup plans.

## How it actually works
- A **backup plan** sets frequency, retention and lifecycle (to cold storage) and selects resources by ID or tag.
- Recovery points live in a **backup vault**. Plans can **copy** recovery points to another Region (DR) and/or another account (ransomware isolation).
- **Vault Lock** in compliance mode makes recovery points immutable for their retention: nobody, including root, can delete them.
- Restores create new resources; RPO equals the backup frequency.

## Numbers that matter
- RPO = backup interval (e.g. 24 h for a daily plan). Restore time grows with data size (tens of minutes to hours).

## Common exam traps
- "Centrally manage and automate backups across services and accounts" → AWS Backup (with Organizations).
- "Protect backups from deletion even by administrators" → Vault Lock (compliance mode), or a copy in a separate account.
- Backups are the cheapest DR strategy but have the worst RPO/RTO.

## Related
[[dr-strategies]] · [[rds-backups]] · [[s3-object-lock]] · [[aws-organizations]]
