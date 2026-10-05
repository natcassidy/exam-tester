# API Gateway integrations and limits

## What it is
API Gateway accepts HTTP requests and passes them to an **integration**: Lambda, an HTTP endpoint, or an AWS service directly (SQS, Step Functions, DynamoDB, Kinesis…).

## How it actually works
- **Synchronous Lambda**: the client waits for the function. Long work keeps connections open and burns concurrency.
- **Direct service integration** (e.g. SQS SendMessage): API Gateway writes the request to a queue and returns 200/202 in milliseconds; workers process later. No Lambda in the request path.
- Throttling: account-level default 10,000 requests/s steady with a 5,000 burst (token bucket); per-stage and per-client usage plans below that.

| | REST API | HTTP API |
|---|---|---|
| Price | ≈ $3.50 / million | ≈ $1.00 / million |
| Direct AWS service integrations | Many | A subset (SQS, Step Functions, EventBridge, Kinesis…) |
| Usage plans, API keys, WAF | Yes | No WAF, no usage plans |

## Numbers that matter
- Integration timeout **29 seconds** by default (Regional/private REST APIs can request more). Longer work → 504.

## Common exam traps
- "Request takes minutes" → accept, queue, process asynchronously, return a job ID.
- "Spiky writes, decouple" → API Gateway → SQS → Lambda.

## Related
[[lambda-concurrency]] · [[sqs-visibility-timeout]]
