# EBS, EFS and FSx

## What it is
AWS's block and file storage: **EBS** volumes for one EC2 instance, **EFS** shared NFS for Linux, **FSx** managed Windows File Server, Lustre, NetApp ONTAP and OpenZFS.

## How it actually works
| | EBS | EFS | FSx for Windows | FSx for Lustre |
|---|---|---|---|---|
| Protocol | Block (attached) | NFS | SMB, AD-integrated | Lustre (POSIX, HPC) |
| Sharing | One instance (io2 Multi-Attach aside) | Thousands of instances, multi-AZ | Many Windows clients | Many compute nodes |
| Scope | One AZ | Regional | Single or Multi-AZ | One AZ |

- EBS types: gp3 (general, IOPS independent of size), io2 Block Express (highest IOPS, durability), st1/sc1 (throughput HDD). Snapshots go to S3 and copy across Regions.
- EFS storage classes (Standard, IA, Archive) with lifecycle management; One Zone option.
- FSx for Lustre can link to an S3 bucket for HPC and ML.

## Numbers that matter
- gp3 baseline 3,000 IOPS / 125 MB/s; io2 Block Express up to 256,000 IOPS.

## Common exam traps
- "Shared file system for many Linux instances across AZs" → EFS.
- "Windows SMB shares with Active Directory" → FSx for Windows File Server.
- "High-performance computing on data in S3" → FSx for Lustre.
- An EBS volume is AZ-bound: move it with a snapshot.

## Related
[[datasync]] · [[s3-storage-classes]] · [[encryption-at-rest]]
