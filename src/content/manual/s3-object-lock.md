# S3 Object Lock (WORM)

## What it is
Write-once-read-many protection for object versions: a locked version can't be deleted or overwritten until its retention date.

## How it actually works
- Requires versioning (enabled at bucket creation, or later for existing buckets).
- **Compliance mode**: nobody, including the root user, can delete the version or shorten retention. **Governance mode**: users with s3:BypassGovernanceRetention can.
- **Legal hold**: no expiry date; stays until removed.
- A default retention on the bucket applies to every new object.
- Meets SEC 17a-4, FINRA and similar WORM requirements in compliance mode.

## Numbers that matter
- Retention from 1 day to 100 years.

## Common exam traps
- "No one, not even the root user, may delete for 7 years" → Object Lock **compliance** mode.
- "Most users can't delete, but special admins can" → governance mode.
- Glacier Vault Lock is the older equivalent for Glacier vaults; AWS Backup Vault Lock for backups.

## Related
[[s3-versioning]] · [[aws-backup]] · [[s3-lifecycle]] · [[s3-replication]]
