# AWS DataSync and Storage Gateway

## What it is
**DataSync** is an online transfer service that copies files between on-premises storage (NFS, SMB, HDFS, object) and AWS (S3, EFS, FSx), fast and scheduled. **Storage Gateway** keeps on-premises applications using file, volume or tape interfaces backed by AWS storage.

## How it actually works
- DataSync uses an agent on-premises, verifies data, preserves metadata, and on each scheduled run copies **only what changed**.
- It runs over the internet, VPN or Direct Connect; speed is bounded by the link.
- Storage Gateway types: **File Gateway** (NFS/SMB to S3, local cache), **FSx File Gateway**, **Volume Gateway** (iSCSI, cached or stored), **Tape Gateway** (virtual tape library for backup software).

## Numbers that matter
- DataSync ≈ $0.0125 per GB copied.

## Common exam traps
- "Migrate or regularly sync file shares to S3/EFS/FSx online" → DataSync.
- "On-premises apps keep using NFS/SMB but store data in S3" → File Gateway.
- "Replace physical tape backups" → Tape Gateway.

## Related
[[snow-family]] · [[data-migration]] · [[block-file-storage]] · [[site-to-site-vpn]]
