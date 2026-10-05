# Lambda concurrency

## What it is
The number of function executions running at the same moment. Concurrency ≈ requests per second × average duration in seconds.

## How it actually works
- The account has a Regional limit (default **1,000**) shared by all functions.
- **Reserved concurrency** guarantees a function that many and also **caps** it there. Lambda keeps at least 100 unreserved for other functions.
- **Provisioned concurrency** keeps execution environments warm to remove cold starts (costs money while idle).
- Over the limit: synchronous calls get **429 TooManyRequestsException**; asynchronous and SQS-triggered work waits and retries.
- SQS event sources scale up to ~300 additional concurrent executions per minute, up to 1,250 (or the event source's maximum concurrency setting).

## Numbers that matter
- 10 rps × 45 s = 450 concurrent executions.
- Timeout up to 15 minutes. ≈ $0.20 per million requests + $0.0000166667 per GB-second.

## Common exam traps
- "Protect a downstream system that allows N connections" → reserved concurrency (or SQS maximum concurrency) = N.
- Cold starts → provisioned concurrency, not more memory or reserved concurrency.

## Related
[[apigw-integrations]] · [[sqs-visibility-timeout]]
