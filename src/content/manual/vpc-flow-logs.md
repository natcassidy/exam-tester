# VPC Flow Logs

## What it is
Records of IP traffic accepted or rejected at network interfaces, published to CloudWatch Logs, S3 or Firehose. The first place to look when "packets disappear".

## How it actually works
- Captured per VPC, subnet or ENI. Each record covers a capture window (up to 10 minutes, or 1 minute) of one flow direction.
- Default fields: `version account-id interface-id srcaddr dstaddr srcport dstport protocol packets bytes start end action log-status`.
- `action` is ACCEPT or REJECT. A REJECT means a security group or NACL dropped it.
- Reading direction matters: an inbound ACCEPT followed by an outbound REJECT of the response (src port 443 → dst high port) is the signature of a **stateless NACL** missing its ephemeral rule. Security groups, being stateful, never reject the response to an accepted request.
- Flow logs record metadata, not packet contents; they don't capture DNS to the Route 53 Resolver or instance metadata traffic.

## Numbers that matter
- Not real-time: records arrive minutes after the traffic.

## Common exam traps
- "Find out why connections to an instance fail" → VPC Flow Logs (REJECT).
- "Inspect packet payloads" → Traffic Mirroring, not Flow Logs.

## Related
[[sg-vs-nacl]] · [[nacls]] · [[cloudtrail]]
