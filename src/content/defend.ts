// Defend rounds (Stage 4): after selected events, the player justifies the design in 1-2
// sentences, then compares it with a model answer and ticks the rubric points they covered.
// Self-graded, so it counts as evidence at half the weight of an objective check.
// Keys are `missionId/eventId`.

export interface DefendSpec {
  prompt: string;
  model: string;
  rubric: string[];
}

export const DEFENDS: Record<string, DefendSpec> = {
  'portfolio/direct': {
    prompt: 'Why can a scraper no longer download files straight from the bucket, while visitors still see the site?',
    model: 'Block Public Access stays on and the bucket policy only allows the CloudFront service principal for this distribution (Origin Access Control, scoped with AWS:SourceArn), so anonymous requests to the bucket are denied while CloudFront fetches objects with signed requests.',
    rubric: ['Block Public Access stays on (no public bucket policy)', 'Origin Access Control signs CloudFront\'s requests to S3', 'The bucket policy allows only that distribution (SourceArn)', 'Visitors go through CloudFront, never to S3 directly'],
  },
  'ledgerly/az-outage': {
    prompt: 'A whole AZ just failed. Explain why customers were back within five minutes and lost at most a minute of data.',
    model: 'RDS Multi-AZ promoted its synchronous standby in about 90 seconds, so no committed write was lost, and the Auto Scaling group spans both AZs with enough instances that the surviving AZ carries the load on its own (static stability) while the ALB stops routing to the failed targets. Each AZ has its own NAT gateway, so outbound access survived too.',
    rubric: ['Multi-AZ: synchronous standby, automatic failover, RPO 0', 'Fleet spread across AZs and sized to survive losing one (static stability)', 'The ALB health checks stop sending traffic to the dead AZ', 'One NAT gateway per AZ keeps outbound access'],
  },
  'dropshop/queue': {
    prompt: 'Why is every good order charged exactly once, bad orders set aside, and the payment provider never overloaded?',
    model: 'API Gateway writes each order to SQS, the queue\'s visibility timeout (6× the Lambda timeout) is longer than the 45-second processing time so a message is not handed to a second worker mid-charge, a dead-letter queue catches messages that fail maxReceiveCount times, and reserved concurrency of 300 caps how many charges run at once.',
    rubric: ['The queue absorbs the spike and decouples the API from processing', 'Visibility timeout longer than processing (no duplicate delivery mid-charge)', 'A dead-letter queue with maxReceiveCount for poison messages', 'Reserved concurrency caps calls to the payment provider'],
  },
  'northwind/s3-path': {
    prompt: 'Why does the nightly 20 TB from S3 no longer show up as a NAT gateway charge?',
    model: 'A free S3 gateway endpoint is associated with both batch route tables, so the prefix-list route (pl-s3) is more specific than 0.0.0.0/0 and S3 traffic bypasses the NAT gateway entirely; the NAT stays only for patch downloads from the internet.',
    rubric: ['S3 gateway endpoint (free) instead of the NAT for S3 traffic', 'Associated with every private route table that reads S3', 'The prefix-list route wins over 0.0.0.0/0', 'NAT kept for real internet traffic (patches)'],
  },
  'dr-region/region-outage': {
    prompt: 'Defend your DR strategy: why does it meet a 15-minute RPO and 1-hour RTO at the lowest cost?',
    model: 'It is pilot light: a cross-Region read replica keeps data seconds behind (RPO well under 15 minutes), the DR Auto Scaling group sits at zero and launches on failover, and Route 53 failover routing with health checks moves users once the primary is unhealthy. Recovery fits in an hour, and almost nothing runs in the DR Region day to day.',
    rubric: ['Data replicated continuously to the DR Region (cross-Region replica)', 'Compute is off or minimal until a disaster (pilot light)', 'Route 53 failover routing with health checks redirects users', 'Cheaper than warm standby or multi-site while meeting RTO/RPO'],
  },
  'leaderboard/latency': {
    prompt: 'Why does every player now save a score in tens of milliseconds, wherever they are?',
    model: 'The API runs in three Regions behind Route 53 latency-based routing, so each player reaches the nearest Region, and a DynamoDB global table gives each Region a local writable replica (with DAX for the hot reads), so no request crosses an ocean.',
    rubric: ['Route 53 latency-based routing to the nearest Region', 'The API deployed in several Regions', 'DynamoDB global table: a local writable replica per Region', 'DAX caches the hottest reads'],
  },
  'branch-office/failover': {
    prompt: 'The fibre was cut. Explain why payroll kept working.',
    model: 'Direct Connect carries traffic normally, and a Site-to-Site VPN over the internet is attached as a backup; BGP prefers the DX path and fails over to the VPN when the DX goes down, and the route tables send on-premises traffic to the virtual private gateway either way.',
    rubric: ['A Site-to-Site VPN as backup for Direct Connect', 'BGP prefers DX and falls back to the VPN automatically', 'Routes to the on-premises CIDR point at the VGW', 'Encryption still holds (IPsec)'],
  },
  'twelve-vpcs/dev-prod': {
    prompt: 'Why can a developer no longer reach production, even though both VPCs are on the same transit gateway?',
    model: 'Prod and dev are associated with separate transit gateway route tables: rt-dev only has propagations from shared services (and on-premises), not from prod, so there is no route from dev to the prod CIDR, while both can still reach shared.',
    rubric: ['Separate TGW route tables per environment (associations)', 'Propagate only the routes each environment may use', 'No dev → prod route means traffic is dropped at the TGW', 'Shared services stay reachable from both'],
  },
  'invoices/ransomware': {
    prompt: 'Attackers stole an admin\'s keys and deleted everything they could. Why could you still restore every invoice?',
    model: 'Object Lock in compliance mode makes each version undeletable for seven years, even by the root user, and versions are replicated to a bucket in a separate account that the stolen credentials can\'t touch, so the data survives in two places.',
    rubric: ['Object Lock in compliance mode (not governance)', 'Versioning keeps prior versions', 'A copy in a separate account outside the attacker\'s reach', 'Retention matches the seven-year requirement'],
  },
  'scans/cost': {
    prompt: 'Justify your lifecycle: why is it the cheapest one that still meets every retrieval requirement?',
    model: 'Scans move to Glacier Instant Retrieval after 30 days, which still opens in milliseconds for the rest of the first year, then to Deep Archive at a year, when 12-hour legal retrieval is acceptable, and expire at seven years. Each class is used after its minimum storage duration is covered.',
    rubric: ['Hot first month in Standard', 'Millisecond class (Glacier IR) while doctors still open scans', 'Deep Archive once 12-hour retrieval is acceptable', 'Expire at the end of retention; no early-deletion charges'],
  },
  'clickstream/fanout': {
    prompt: 'Two teams read the same clicks. Why doesn\'t either one fall behind?',
    model: 'The stream has enough shards for the ingest rate, and the second consumer uses enhanced fan-out, so each consumer gets its own 2 MB/s per shard instead of sharing one 2 MB/s read pipe with Firehose and the other Lambda.',
    rubric: ['Shard count sized from MB/s and records/s', 'Standard consumers share 2 MB/s per shard', 'Enhanced fan-out gives a consumer dedicated throughput', 'Kinesis (not SQS) because both teams need every record'],
  },
  'migration80/bulk': {
    prompt: 'Why ship disks instead of using the network for the 80 TB?',
    model: 'At 100 Mbps, 80 TB would take about 74 days even at full utilisation, far past the deadline, while a Snowball Edge job moves it in about a week; DataSync then copies the changes made in the meantime over the network.',
    rubric: ['Did the arithmetic: 80 TB over 100 Mbps ≈ 74 days', 'Snowball moves the bulk offline in about a week', 'DataSync for the ongoing changes', 'Direct Connect takes weeks to provision, too late'],
  },
  'rf-spot/crunch': {
    prompt: 'Spot capacity got tight and you still had 10 workers. Why?',
    model: 'Two workers are an On-Demand base that can never be reclaimed, and the Spot capacity above it can use three instance types across two AZs with price-capacity-optimized allocation, so it sits in deep pools rather than the cheapest, most contested ones.',
    rubric: ['An On-Demand base for capacity you can never lose', 'Several instance types (and AZs) = more Spot pools', 'Capacity-aware allocation (capacity-optimized / price-capacity-optimized)', 'The work is checkpointed, so interruptions are tolerable'],
  },
  'rf-commit/stranded': {
    prompt: 'Why does your commitment survive the move to Lambda and to c5?',
    model: 'A 3-year Compute Savings Plan applies to any instance family, size and Region, and to Lambda and Fargate, so the same commitment follows the workload; it is sized to the smallest usage the roadmap guarantees, so no hour goes unused.',
    rubric: ['Compute Savings Plan (not EC2 Instance SP or Standard RIs)', 'It covers other families and Lambda/Fargate', 'Sized to the guaranteed baseline, not today\'s peak', '3-year term for the bigger discount on a 3-year workload'],
  },
  'rf-db/bill': {
    prompt: 'You cut the database bill by more than half. Why is lunchtime still fast and failover still automatic?',
    model: 'The primary was eight times bigger than its peak load, so a smaller class carries the writes, a read replica takes most of the 80% read traffic at the rush, and Multi-AZ stays on for automatic failover with no data loss.',
    rubric: ['Sized from CloudWatch: CPU never above 15%', 'Read replica (or reader endpoint) for the read-heavy rush', 'Kept Multi-AZ for availability; it adds no capacity', 'Aurora Serverless v2 is the alternative for spiky load'],
  },
  'rf-s3/media-cost': {
    prompt: 'Why Intelligent-Tiering for the photos instead of a lifecycle rule?',
    model: 'Old albums are read unpredictably, so any fixed rule either keeps everything in Standard or moves photos into a class that charges per GB read (or can\'t serve them instantly); Intelligent-Tiering moves each object down after 30 and 90 days without access and back up when it is read, with no retrieval fees, and every tier answers in milliseconds.',
    rubric: ['Access is unpredictable, so fixed transitions guess wrong', 'Objects move down automatically and back up on access', 'No retrieval fees; millisecond access in the default tiers', 'Expiration still enforces the 2-year retention'],
  },
  'rf-az/bill': {
    prompt: 'Why did adding a NAT gateway and an endpoint make the bill smaller?',
    model: 'The S3 gateway endpoint is free and takes the 20 TB of S3 traffic off the NAT gateway (no $0.045/GB processing), and with a NAT in each AZ the remaining internet traffic no longer crosses AZs, which also removes the single point of failure.',
    rubric: ['Gateway endpoint for S3 on every private route table', 'NAT processing is charged per GB, whatever the destination', 'One NAT per AZ removes cross-AZ transfer', 'Also fixes the AZ single point of failure'],
  },
};
