# Fan-out: SNS, SQS, EventBridge, Kinesis

## What it is
Patterns for delivering one event to several independent consumers.

## How it actually works
| Service | Model | Ordering | Replay | Fan-out |
|---|---|---|---|---|
| SQS Standard | Queue: each message to one consumer | Best effort | No | Needs SNS in front |
| SQS FIFO | Queue | Per message group | No | Via SNS FIFO |
| SNS | Pub/sub push | FIFO topics only | No | Yes, to many subscribers |
| EventBridge | Event bus with rules | No | Archive & replay | Yes, rule targets |
| Kinesis Data Streams | Log of records | Per shard | Yes (retention) | Yes, many readers |

- SNS → several SQS queues ("fan-out") lets each consumer process at its own pace with retries and DLQs.
- EventBridge routes on event content and integrates SaaS sources and schedules.

## Numbers that matter
- SQS FIFO: 300 msg/s per API action (3,000 with batching; more with high-throughput mode).

## Common exam traps
- "One event processed by several services in parallel" → SNS + SQS fan-out (or EventBridge).
- "Ordered and replayable" → Kinesis.
- A single SQS queue splits messages between consumers instead of copying them.

## Related
[[kinesis-data-streams]] · [[sqs-dlq]] · [[sqs-visibility-timeout]] · [[lambda-concurrency]]
