# S3 Versioning and MFA Delete

## What it is
Versioning keeps every version of every object. A delete adds a **delete marker** instead of removing data. MFA Delete requires the root user's MFA to permanently delete a version or change versioning.

## How it actually works
- Once enabled, versioning can be suspended but never fully disabled. Each version is billed as storage.
- Undo a delete by removing the delete marker; undo an overwrite by restoring a previous version.
- A user with s3:DeleteObjectVersion can still delete specific versions. MFA Delete (root only, via CLI/API) stops that.
- Replication and Object Lock require versioning.

## Numbers that matter
- Noncurrent versions cost the same as current ones; use lifecycle noncurrent-version expiration.

## Common exam traps
- "Protect against accidental deletion" → versioning (+ MFA Delete).
- Versioning alone does not stop a malicious administrator.
- WORM compliance needs [[s3-object-lock]].

## Related
[[s3-object-lock]] · [[s3-replication]] · [[s3-lifecycle]] · [[s3-bucket-policy]]
