# S3 Intelligent-Tiering

## What it is
A storage class that **moves each object between access tiers automatically** based on when it was last read, with no retrieval fees.

## How it actually works
- Frequent Access tier (Standard price) → after **30 days** without access, Infrequent Access (Standard-IA price) → after **90 days**, Archive Instant Access (Glacier Instant Retrieval price). All three return the first byte in milliseconds.
- Reading an object moves it back to Frequent Access.
- Optional Archive Access (90+ days) and Deep Archive Access (180+ days) tiers are opt-in and need a restore before reading, like Glacier.
- A small **monitoring and automation charge per object** (objects under 128 KB are not monitored and always billed at the Frequent rate).
- No minimum storage duration and no retrieval charges, unlike Standard-IA (30 days) or Glacier Instant Retrieval (90 days).

## Numbers that matter
- Monitoring ≈ $0.0025 per 1,000 objects per month.
- Standard-IA charges $0.01/GB to read; Glacier Instant Retrieval $0.03/GB.

## Common exam traps
- "Unknown or changing access patterns", "don't want to manage lifecycle rules" → Intelligent-Tiering.
- Known, predictable patterns (old data is never read) → lifecycle transitions are cheaper (no monitoring fee).
- Short-lived objects in IA or Glacier classes still pay their minimum duration: deleting a 10-day-old Standard-IA object bills 30 days.

## Related
[[s3-storage-classes]] · [[s3-lifecycle]]
