# VPC endpoint policies and aws:SourceVpce

## What it is
Two complementary controls for private access to AWS services: an **endpoint policy** on the endpoint (what may pass through it) and **aws:SourceVpce / aws:SourceVpc** conditions in the resource policy (what the resource accepts).

## How it actually works
- An endpoint policy is a resource-based policy on the gateway or interface endpoint. The default allows everything. It filters; it never grants.
- A request through an endpoint carries `aws:SourceVpce` (the endpoint id) and `aws:SourceVpc`. Requests from the internet or the console carry neither, and `aws:SourceIp` is not available for traffic through an endpoint.
- Lock a bucket to a VPC with a **Deny** + `StringNotEquals aws:SourceVpce`. Then exempt legitimate outside callers by adding another condition to the same Deny (conditions are ANDed).

## Numbers that matter
- Gateway endpoints (S3, DynamoDB): free. Interface endpoints: about $0.01 per hour per AZ plus $0.01 per GB.

## Common exam traps
- "Only allow access to the bucket from our VPC" → bucket policy Deny with aws:SourceVpce (or aws:SourceVpc).
- "Prevent instances from copying data to buckets outside our account" → endpoint policy that only allows your buckets.
- A Deny-unless-VPCE policy blocks the console too.

## Related
[[vpc-gateway-endpoints]] · [[iam-condition-keys]] · [[s3-bucket-policy]]
