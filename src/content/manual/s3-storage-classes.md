# S3 storage classes

## What it is
Price tiers for S3 objects that trade storage cost against retrieval cost, retrieval time, minimum duration and AZ redundancy.

## How it actually works
| Class | First byte | Min. duration | AZs | Use |
|---|---|---|---|---|
| Standard | ms | none | ≥ 3 | Frequent access |
| Intelligent-Tiering | ms (archive tiers optional) | none | ≥ 3 | Unknown or changing access |
| Standard-IA | ms | 30 days | ≥ 3 | Infrequent, needs fast access |
| One Zone-IA | ms | 30 days | 1 | Re-creatable infrequent data |
| Glacier Instant Retrieval | ms | 90 days | ≥ 3 | Archive read about once a quarter |
| Glacier Flexible Retrieval | minutes-hours | 90 days | ≥ 3 | Archive, restore in hours |
| Glacier Deep Archive | 12-48 h | 180 days | ≥ 3 | Long-term compliance archives |

- IA and Glacier classes charge per GB retrieved and charge the remaining days if you delete or transition early.
- Glacier Flexible and Deep Archive objects must be **restored** before they can be read.

## Numbers that matter
- Per GB-month (us-east-1, approx.): Standard $0.023, IA $0.0125, One Zone-IA $0.01, Glacier IR $0.004, Flexible $0.0036, Deep Archive $0.00099.

## Common exam traps
- "Rarely accessed but needs millisecond retrieval" → Glacier Instant Retrieval (or IA).
- "Retrieval within 12 hours, lowest cost" → Deep Archive.
- One Zone-IA only for data you can re-create.
- "Unknown access patterns" → Intelligent-Tiering.

## Related
[[s3-lifecycle]] · [[s3-versioning]] · [[s3-replication]] · [[data-transfer-costs]]
