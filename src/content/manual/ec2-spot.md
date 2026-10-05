# EC2 Spot Instances

## What it is
Spare EC2 capacity sold at a steep discount (often 60-90% below On-Demand). AWS can take it back with a **two-minute interruption notice** whenever it needs the capacity.

## How it actually works
- Every instance type in every Availability Zone is a separate **Spot capacity pool** with its own price and spare capacity.
- An Auto Scaling group with a **mixed instances policy** sets an **On-Demand base** (instances that are never Spot), the **percentage of Spot** above that base, the instance types it may use, and an **allocation strategy**:
  - `lowest-price`: launches into the cheapest pools. The cheapest pools are the most contested, so they are interrupted most.
  - `capacity-optimized`: launches into the pools with the most spare capacity, so interruptions are rarer.
  - `price-capacity-optimized`: picks the lowest price among the pools with the most capacity. AWS's recommended default for most workloads.
- The more instance types (and AZs) you allow, the more pools the group can choose from and the more it can replace interrupted capacity.
- **Capacity Rebalancing** lets the group launch a replacement when EC2 signals an elevated interruption risk, before the two-minute notice.
- Spot suits work that is stateless, fault-tolerant or checkpointed: batch, CI, rendering, big data, containers behind a load balancer.

## Numbers that matter
- Interruption notice: **2 minutes** (instance metadata and EventBridge).
- In this game, Spot costs about 35% of the On-Demand price; real prices float with supply and demand.

## Common exam traps
- "Cheapest, the job can be interrupted and restarted" → Spot. "Must not be interrupted" → On-Demand, Savings Plans or Reserved Instances.
- A baseline that must always run → On-Demand base (or a commitment), Spot above it.
- Diversify: one instance type in one AZ means one pool, so one bad day takes all your Spot capacity.
- Spot blocks (fixed-duration Spot) are no longer offered.

## Related
[[ec2-purchase-options]] · [[asg-scaling]] · [[static-stability]]
