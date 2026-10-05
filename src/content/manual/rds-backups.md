# RDS backups and point-in-time restore

## What it is
Automated daily snapshots plus transaction logs, kept for a retention period, that let you restore a database to any second within that window.

## How it actually works
- Retention 1-35 days (0 disables automated backups and point-in-time restore).
- Transaction logs are uploaded to S3 about every **5 minutes**, so the latest restorable time is ~5 minutes behind.
- A restore always creates a **new** instance with a new endpoint. It takes tens of minutes, growing with size.
- Manual snapshots are kept until you delete them; they can be copied to other Regions/accounts.

## Numbers that matter
- RPO of point-in-time restore ≈ 5 minutes. RTO ≈ 30-60+ minutes.
- Backup storage up to the size of the database is free in the Region.

## Common exam traps
- Backups are disaster recovery, not high availability: RTO is far too slow for "back within minutes".
- Retention 0 = no point-in-time restore; read replicas also require backups to be enabled.

## Related
[[rds-multi-az]] · [[rds-read-replicas]]
