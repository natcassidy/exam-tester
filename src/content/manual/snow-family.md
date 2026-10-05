# AWS Snow Family

## What it is
Rugged devices AWS ships to you for **offline** data transfer and edge computing: Snowball Edge (Storage Optimized / Compute Optimized). (Snowcone and Snowmobile have been retired for new customers.)

## How it actually works
- Order a job, receive the device, copy data over the local network, ship it back; AWS imports it into S3.
- Data is encrypted with KMS keys; the device is tamper-evident.
- Snowball Edge can also run EC2 instances and Lambda at disconnected edge sites.

## Numbers that matter
- Tens of TB per device (≈ 80 TB usable in the game). End to end ≈ a week: shipping both ways + copy + import.
- Rule of thumb: if the network would take more than about a week, ship the data.

## Common exam traps
- "Tens or hundreds of TB, limited bandwidth, deadline in days" → Snowball Edge.
- Changes made after the copy still need an online sync ([[datasync]]).
- Petabytes across many devices → several Snowball jobs in parallel.

## Related
[[datasync]] · [[data-migration]] · [[direct-connect]]
