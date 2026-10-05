# ElastiCache and caching strategies

## What it is
Managed in-memory caches, **Redis OSS / Valkey** and **Memcached**, that serve hot data in sub-millisecond time and take repeated reads off the database.

## How it actually works
- **Lazy loading (cache-aside):** read the cache; on a miss, read the database and write the result to the cache. Only requested data is cached; a miss costs three trips.
- **Write-through:** write to the cache whenever you write to the database. Data is never stale, but you cache things nobody reads. Combine with a **TTL**.
- **Redis / Valkey:** replication, Multi-AZ automatic failover, persistence, sorted sets (leaderboards), pub/sub, backups. **Memcached:** simple, multi-threaded, no replication or persistence.
- Session stores: keep user sessions in ElastiCache (or DynamoDB) so web servers stay stateless behind a load balancer.
- DynamoDB has its own cache, **DAX**; CloudFront caches at the edge.

## Numbers that matter
- Microsecond-to-millisecond reads vs. several milliseconds for a database query.

## Common exam traps
- "Read-heavy, same queries repeated, reduce database load" → ElastiCache (or a read replica if the queries vary).
- "High availability for the cache" → Redis/Valkey with Multi-AZ, not Memcached.
- "Leaderboard / real-time ranking" → Redis sorted sets.
- Caching needs code changes in the application (unlike a read replica endpoint swap).

## Related
[[dax]] · [[rds-read-replicas]] · [[db-right-sizing]] · [[cloudfront-edge]]
