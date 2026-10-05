# Right-sizing databases

## What it is
Matching database capacity (instance class, replicas, serverless capacity) to the load the database really has, instead of what someone guessed at launch.

## How it actually works
- Look at **CloudWatch metrics** (CPUUtilization, FreeableMemory, ReadIOPS / WriteIOPS, DatabaseConnections) and **Performance Insights** over weeks, including the busiest hour.
- **Scale reads out, not up:** read replicas (RDS) or Aurora Replicas behind the reader endpoint take read traffic off the primary.
- **Multi-AZ is for availability**, not capacity: the standby takes no traffic (except Multi-AZ DB clusters' readable standbys). Keep it when the business needs fast failover; it roughly doubles the instance cost.
- **Aurora Serverless v2** scales capacity in fine steps (0.5 ACU increments, about 2 GiB each) between a minimum and maximum, so you pay for what the load uses. Good for spiky, unpredictable or intermittent load; a steady, well-known load is usually cheaper on a right-sized provisioned instance.
- **Compute Optimizer** recommends RDS and EC2 sizes from utilisation history.
- Changing an RDS instance class causes a short outage (shorter with Multi-AZ, which modifies the standby first).

## Numbers that matter
- db.r5.xlarge Multi-AZ ≈ $730/month; db.t3.medium Multi-AZ ≈ $100/month (approximate, us-east-1).
- Aurora Serverless v2 ≈ $0.12 per ACU-hour.

## Common exam traps
- "Database CPU at 8%, bill too high" → smaller class. "Reads slow at peak" → read replica, not a bigger primary.
- A read replica is **not** an HA solution by itself: failover to it is manual and replication is asynchronous.
- "Unpredictable / intermittent load, minimal management" → Aurora Serverless v2.

## Related
[[rds-read-replicas]] · [[rds-multi-az]] · [[aurora]] · [[elasticache]]
