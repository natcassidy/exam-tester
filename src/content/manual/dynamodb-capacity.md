# DynamoDB capacity modes

## What it is
How you pay for and get throughput on a table: **on-demand** (per request, no planning) or **provisioned** (read/write capacity units per second, optionally auto scaled).

## How it actually works
- 1 WCU = one write/s of up to 1 KB. 1 RCU = one strongly consistent read/s of up to 4 KB (or two eventually consistent).
- Provisioned: requests above capacity (plus burst credit) are **throttled**. Auto scaling adjusts over minutes.
- On-demand: absorbs sudden traffic up to double the previous peak instantly, more over time.

| | On-demand | Provisioned |
|---|---|---|
| Planning | None | Choose WCU/RCU, auto scaling bounds |
| Spikes | Absorbed | Throttled until scaling catches up |
| Price for steady load | Higher | Lower (plus reserved capacity) |

## Numbers that matter
- On-demand ≈ $0.625 per million writes and $0.125 per million reads (us-east-1, after the Nov 2024 price cut).
- Storage ≈ $0.25/GB-month.

## Common exam traps
- Unpredictable/spiky or new workload → on-demand. Steady, predictable → provisioned (+ auto scaling).
- DAX caches reads only; it doesn't help write throughput.

## Related
[[lambda-concurrency]]
