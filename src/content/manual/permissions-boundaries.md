# Permissions boundaries

## What it is
A managed policy set on a user or role as the **maximum** permissions its identity policies can grant. It never grants anything itself.

## How it actually works
- Effective permissions = identity policy ∩ boundary (minus any explicit deny).
- Typical use: let developers create roles for their apps, but force every role they create to carry a boundary (`iam:PermissionsBoundary` condition), so they can't escalate privileges.
- The boundary is checked alongside the identity policy, after any explicit deny and SCPs.

| | Boundary | SCP |
|---|---|---|
| Applies to | One user or role | Every principal in an account/OU |
| Grants? | Never | Never |
| Managed by | IAM admins in the account | Organization management account |

## Numbers that matter
- One boundary per principal.

## Common exam traps
- "Delegate role creation to developers without letting them grant themselves admin" → permissions boundary.
- An Allow in the boundary alone gives no access.

## Related
[[iam-policy-evaluation]] · [[scps]]
