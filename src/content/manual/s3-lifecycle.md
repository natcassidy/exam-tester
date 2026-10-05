# S3 Lifecycle rules

## What it is
Rules that move objects to cheaper storage classes as they age (**transitions**) and delete them (**expiration**).

## How it actually works
- Transitions only go down the waterfall: Standard → Intelligent-Tiering / Standard-IA → One Zone-IA → Glacier IR → Glacier Flexible → Deep Archive.
- Objects must stay **30 days** in Standard before moving to Standard-IA or One Zone-IA.
- Minimum storage durations still apply: moving out of Glacier IR before 90 days, or deleting from Deep Archive before 180, is charged as if they stayed.
- Rules can filter by prefix or tag and act on current or noncurrent versions (with versioning).
- Each transition is a per-object request charge, so millions of tiny objects can cost more to move than they save.

## Numbers that matter
- Steady-state cost = the sum over each age band of (GB in that band × class price) + retrievals + transitions.

## Common exam traps
- "Delete after 7 years" → expiration action, not a script.
- "Move to IA after 7 days" → not allowed (30-day minimum).
- Clean up old versions with noncurrent-version expiration.

## Related
[[s3-storage-classes]] · [[s3-versioning]] · [[s3-object-lock]]
