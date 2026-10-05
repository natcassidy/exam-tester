# SQS visibility timeout

## What it is
When a consumer receives a message, SQS hides it from other consumers for the **visibility timeout**. If the consumer doesn't delete it in time, it becomes visible again and another consumer can take it.

## How it actually works
- Default 30 s, range 0 s to 12 h. Set per queue, or per message with ChangeMessageVisibility.
- If processing takes longer than the timeout, the message is delivered again **while the first worker is still working**: duplicates.
- Standard queues are **at-least-once** anyway (rare duplicates, best-effort ordering), so consumers should be idempotent.
- FIFO queues: exactly-once processing within a 5-minute deduplication window, ordering per message group.

| | Standard | FIFO |
|---|---|---|
| Throughput | Nearly unlimited | 300 msg/s per API (3,000 with batching; more in high-throughput mode) |
| Delivery | At least once | Exactly once (dedup window) |
| Ordering | Best effort | Per message group |

## Numbers that matter
- For Lambda event sources AWS recommends a visibility timeout of at least **6× the function timeout**.
- Retention: default 4 days, 1 minute to 14 days.

## Common exam traps
- Duplicates from long jobs → raise the visibility timeout (not retention, not long polling).
- Long polling (WaitTimeSeconds up to 20) reduces empty receives and cost.

## Related
[[sqs-dlq]] · [[lambda-concurrency]]
