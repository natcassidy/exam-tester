# IAM policy evaluation logic

## What it is
The rules AWS applies to every signed API request to decide Allow or Deny. Every request starts denied; something must allow it, and nothing may explicitly deny it.

## How it actually works
For a request inside one account, AWS gathers every applicable policy and walks this order:

1. **Explicit deny** in any policy (identity, resource, boundary, SCP, endpoint, session) → **Deny**. Nothing overrides it.
2. **SCPs** (if the account is in AWS Organizations): the action must be allowed by the SCPs at every level. SCPs never grant; they only filter.
3. **Resource-based policy** (bucket, queue, key, trust policy): in the same account, an Allow that names the principal grants access on its own.
4. **Permissions boundary** (if set): must allow too. It is a ceiling.
5. **Identity-based policy**: an Allow here grants access.
6. Otherwise → **implicit deny**.

Cross-account requests need **both** sides: the identity policy in the caller's account and the resource policy in the resource's account.

| Situation | Result |
|---|---|
| Allow in identity policy, nothing else | Allow |
| Allow anywhere + Deny anywhere | Deny |
| Allow only in boundary | Deny (a boundary never grants) |
| Admin user, SCP doesn't allow the action | Deny |
| KMS key policy doesn't allow or delegate | Deny, whatever IAM says |

## Numbers that matter
- Managed policy size: 6,144 characters. Inline role policies: 10,240 characters in total.
- 10 managed policies per role by default (can be raised to 20).

## Common exam traps
- "Add an Allow" never fixes an explicit Deny. Narrow the Deny with a condition instead.
- "Everything is denied by default" includes your own account's admins when an SCP or key policy says no.
- The error text tells you which layer said no: "no identity-based policy allows", "explicit deny in a resource-based policy", "no resource-based policy allows".

## Related
[[resource-vs-identity-policies]] · [[scps]] · [[permissions-boundaries]] · [[kms-key-policies]] · [[iam-condition-keys]]
