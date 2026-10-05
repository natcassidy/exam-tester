# Service control policies (SCPs)

## What it is
AWS Organizations policies that set the maximum available permissions for every principal in member accounts, including the account's root user and administrators.

## How it actually works
- Attached to the root, OUs or accounts. A request must be allowed at **every** level from the root down to the account.
- Default `FullAWSAccess` SCP allows everything; you then add Deny statements ("deny list") or replace it with specific Allows ("allow list").
- SCPs never grant permissions; IAM policies still must allow.
- They do **not** apply to the management account or to service-linked roles.

## Numbers that matter
- 5 SCPs per target, 5,120 characters each.

## Common exam traps
- "Prevent any account from leaving the organization / disabling CloudTrail / using regions outside the EU" → SCP with Deny.
- "Admin user in a member account can't do X" with no IAM deny → look at the SCPs.
- SCPs can't restrict the management account; keep workloads out of it.

## Related
[[iam-policy-evaluation]] · [[permissions-boundaries]]
