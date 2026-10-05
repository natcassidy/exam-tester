# IAM condition keys

## What it is
The `Condition` block makes a statement apply only when the request context matches: where the request came from, how it was signed, which organization the caller belongs to.

## How it actually works
- `"Condition": { "Operator": { "key": "value" } }`. All operators and keys in one block are **ANDed**; multiple values for one key are **ORed**.
- Negated operators (`StringNotEquals`, `NotIpAddress`, `ArnNotLike`) are **true when the key is missing**. Positive operators are false when it's missing. `...IfExists` makes a missing key count as a match.
- Common keys:

| Key | Holds | Typical use |
|---|---|---|
| `aws:SecureTransport` | Was HTTPS used? | Deny if `false` |
| `aws:MultiFactorAuthPresent` | MFA in this session? | Require MFA for deletes |
| `aws:SourceIp` | Caller's public IP | Office-only access (not set via VPC endpoints) |
| `aws:SourceVpce` / `aws:SourceVpc` | Endpoint / VPC the request came through | Lock a bucket to a VPC |
| `aws:PrincipalOrgID` | Caller's AWS Organization | Share with the whole org |
| `aws:PrincipalArn` | Caller's role/user ARN | Exempt an admin role from a Deny |

## Numbers that matter
- Condition key names are case-insensitive; values are case-sensitive for `String*` operators.

## Common exam traps
- A "Deny unless aws:SourceVpce" bucket policy also locks out the console and on-prem users. Exempt them with a second condition (ANDed), not with an Allow.
- `aws:SourceIp` doesn't work for traffic through a VPC endpoint; use `aws:SourceVpce`.

## Related
[[iam-policy-evaluation]] · [[vpc-endpoint-policies]] · [[s3-bucket-policy]]
