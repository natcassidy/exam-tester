# SQS dead-letter queues

## What it is
A second queue that receives messages a consumer failed to process too many times, set by a **redrive policy** on the source queue.

## How it actually works
- `maxReceiveCount`: after this many receives without a delete, SQS moves the message to the DLQ.
- The DLQ must be the same type as the source (Standard → Standard, FIFO → FIFO) in the same account and Region.
- Alarm on the DLQ's `ApproximateNumberOfMessagesVisible`; inspect and **redrive** messages back once fixed.
- Set the DLQ's retention longer than the source queue's (the enqueue timestamp is preserved).

## Numbers that matter
- `maxReceiveCount` 1-1,000; 3-5 is typical. Too low sends merely slow messages to the DLQ.

## Common exam traps
- "A bad message is retried forever / blocks processing" → DLQ with a redrive policy.
- In FIFO queues a poison message blocks its whole message group until it moves to the DLQ.

## Related
[[sqs-visibility-timeout]]
