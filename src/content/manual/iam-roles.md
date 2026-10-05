# IAM roles, instance profiles and AssumeRole

## What it is
A role is an identity with permission policies but **no long-term credentials**. Whoever assumes it gets temporary credentials from STS. EC2 instances get a role through an **instance profile**; Lambda functions through an **execution role**.

## How it actually works
- A role has two policy types: the **trust policy** (who may assume it, a resource-based policy on the role) and **permission policies** (what it may do).
- Assuming a role needs the trust policy to allow the caller. If the trust policy only names the account, the caller also needs `sts:AssumeRole` in its own identity policy. Cross-account: always both.
- EC2: the SDK fetches rotating credentials from the instance metadata service (use IMDSv2). Never put access keys on servers.
- Logs and errors show the session as `arn:aws:sts::ACCOUNT:assumed-role/ROLE/SESSION`. Condition key `aws:PrincipalArn` holds the role ARN.

## Numbers that matter
- Session duration: 1 hour default, up to 12 hours (role chaining caps at 1 hour).
- One role per instance profile.

## Common exam traps
- "Application on EC2 needs S3 access" → instance profile role, not access keys in a config file.
- "Third party needs access to your account" → a role they assume, with an external ID condition.
- A Lambda that can't write to DynamoDB: fix the execution role, not the function code.

## Related
[[iam-policy-evaluation]] · [[resource-vs-identity-policies]] · [[cloudtrail]]
