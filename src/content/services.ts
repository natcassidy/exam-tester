import type { ServiceType } from '../engine/model';

export type Category = 'compute' | 'network' | 'database' | 'storage' | 'integration' | 'security' | 'edge' | 'analytics' | 'hybrid';

export interface ServiceInfo {
  type: ServiceType;
  abbr: string;
  name: string;
  category: Category;
  zoneHint: string;
  examNotes: string[];
  concepts: string[];
}

export const SERVICES: Record<ServiceType, ServiceInfo> = {
  cloudfront: { type: 'cloudfront', abbr: 'CF', name: 'CloudFront', category: 'edge', zoneHint: 'Global edge', examNotes: ['Global users + static content → CloudFront.', 'Private S3 origin → Origin Access Control + bucket policy for cloudfront.amazonaws.com.', 'Origin → CloudFront transfer is free.'], concepts: ['cloudfront-edge', 'cloudfront-oac'] },
  route53: { type: 'route53', abbr: 'R53', name: 'Route 53', category: 'edge', zoneHint: 'Global edge', examNotes: ['Alias records work at the zone apex and are free for AWS targets.', 'Failover = active/passive with health checks. Latency = nearest healthy Region. Geolocation = by user location (add a default).', 'Failover time ≈ health check interval × threshold + TTL.'], concepts: ['route53-alias', 'route53-routing-policies'] },
  waf: { type: 'waf', abbr: 'WAF', name: 'AWS WAF', category: 'security', zoneHint: 'Global edge (associate with ALB or CloudFront)', examNotes: ['SQL injection / XSS / rate limiting → WAF.', 'Attaches to CloudFront, ALB, API Gateway, AppSync, Cognito. Not NLB.'], concepts: ['aws-waf'] },
  s3: { type: 's3', abbr: 'S3', name: 'S3 bucket', category: 'storage', zoneHint: 'Region', examNotes: ['Block Public Access at the account level prevents any public bucket.', 'All new objects are encrypted (SSE-S3) by default.', 'Private subnets reach S3 for free through a gateway endpoint.'], concepts: ['s3-block-public-access', 's3-bucket-policy', 'encryption-at-rest'] },
  sqs: { type: 'sqs', abbr: 'SQS', name: 'SQS queue', category: 'integration', zoneHint: 'Region', examNotes: ['Visibility timeout must exceed processing time (6× the Lambda timeout for event sources).', 'Poison messages → dead-letter queue with maxReceiveCount.', 'Standard = at-least-once; FIFO = exactly-once + ordering, lower throughput.'], concepts: ['sqs-visibility-timeout', 'sqs-dlq'] },
  lambda: { type: 'lambda', abbr: 'λ', name: 'Lambda function', category: 'compute', zoneHint: 'Region', examNotes: ['Concurrency ≈ rps × duration. Account default 1,000.', 'Reserved concurrency guarantees and caps a function.', 'Max timeout 15 minutes.'], concepts: ['lambda-concurrency'] },
  apigw: { type: 'apigw', abbr: 'API', name: 'API Gateway', category: 'integration', zoneHint: 'Region', examNotes: ['29 s default integration timeout.', 'Direct SQS integration decouples spiky writes without a Lambda in the request path.', 'Default account throttle 10,000 rps, burst 5,000.'], concepts: ['apigw-integrations'] },
  dynamodb: { type: 'dynamodb', abbr: 'DDB', name: 'DynamoDB table', category: 'database', zoneHint: 'Region', examNotes: ['Spiky / unpredictable → on-demand. Steady → provisioned + auto scaling.', 'Gateway endpoint available (free), like S3.'], concepts: ['dynamodb-capacity'] },
  igw: { type: 'igw', abbr: 'IGW', name: 'Internet gateway', category: 'network', zoneHint: 'VPC attachment', examNotes: ['One per VPC. Free.', 'A subnet is public only if its route table sends 0.0.0.0/0 here.'], concepts: ['internet-gateway', 'vpc-public-private'] },
  vpce: { type: 'vpce', abbr: 'VPCE', name: 'Gateway endpoint', category: 'network', zoneHint: 'VPC attachment', examNotes: ['S3 and DynamoDB only. Free.', 'Works only for the route tables it is associated with.'], concepts: ['vpc-gateway-endpoints'] },
  nat: { type: 'nat', abbr: 'NAT', name: 'NAT gateway', category: 'network', zoneHint: 'Public subnet', examNotes: ['AZ-scoped: one per AZ for resilience.', '$0.045/hour + $0.045/GB processed.', 'Outbound only: nothing on the internet can start a connection in.'], concepts: ['nat-gateway', 'nat-data-processing'] },
  alb: { type: 'alb', abbr: 'ALB', name: 'Application LB', category: 'network', zoneHint: 'Subnets in ≥ 2 AZs', examNotes: ['At least two AZs.', '502 bad gateway, 503 no healthy targets, 504 target timeout.', 'Static IP needed → NLB.'], concepts: ['alb', 'alb-health-checks'] },
  ec2: { type: 'ec2', abbr: 'EC2', name: 'EC2 instance', category: 'compute', zoneHint: 'Subnet', examNotes: ['A single instance is a single point of failure.', 'Needs a public IP to use an internet gateway.'], concepts: ['security-groups'] },
  asg: { type: 'asg', abbr: 'ASG', name: 'Auto Scaling group', category: 'compute', zoneHint: 'Subnets across AZs', examNotes: ['Predictable spikes → scheduled scaling.', 'Use ELB health checks behind a load balancer.', 'Warmup delays when new capacity counts.'], concepts: ['asg-scaling', 'static-stability'] },
  aurora: { type: 'aurora', abbr: 'AUR', name: 'Aurora cluster', category: 'database', zoneHint: 'Data subnets (≥ 2 AZs)', examNotes: ['Storage: 6 copies across 3 AZs. Up to 15 replicas, failover ~30 s.', 'Global Database: cross-Region replication typically < 1 s, promote in ~1 min.', 'Serverless v2: scales in ACUs for spiky or unknown load.'], concepts: ['aurora', 'aurora-global'] },
  pcx: { type: 'pcx', abbr: 'PCX', name: 'VPC peering', category: 'network', zoneHint: 'VPC attachment (requester VPC)', examNotes: ['Not transitive. No edge-to-edge routing.', 'CIDRs must not overlap. Routes needed on both sides.', 'Free to create; you pay for data crossing AZs or Regions.'], concepts: ['vpc-peering'] },
  tgw: { type: 'tgw', abbr: 'TGW', name: 'Transit gateway', category: 'network', zoneHint: 'Region', examNotes: ['Hub-and-spoke for many VPCs and on-premises: transitive by design.', 'Route tables + associations + propagations give segmentation (prod vs. dev).', 'Share across accounts with AWS RAM.'], concepts: ['transit-gateway'] },
  vgw: { type: 'vgw', abbr: 'VGW', name: 'Virtual private gateway', category: 'hybrid', zoneHint: 'VPC attachment', examNotes: ['The AWS side of a VPN or Direct Connect for one VPC.', 'The VPC route table still needs on-premises CIDR → VGW (or route propagation).'], concepts: ['site-to-site-vpn', 'direct-connect'] },
  cgw: { type: 'cgw', abbr: 'CGW', name: 'Customer gateway', category: 'hybrid', zoneHint: 'On-premises', examNotes: ['Represents your on-premises VPN device (public IP, BGP ASN).'], concepts: ['site-to-site-vpn'] },
  vpn: { type: 'vpn', abbr: 'VPN', name: 'Site-to-Site VPN', category: 'hybrid', zoneHint: 'On-premises', examNotes: ['Up in minutes over the internet. IPsec encrypted.', '~1.25 Gbps per tunnel, two tunnels per connection.', 'The classic low-cost backup for Direct Connect.'], concepts: ['site-to-site-vpn', 'hybrid-connectivity'] },
  dx: { type: 'dx', abbr: 'DX', name: 'Direct Connect', category: 'hybrid', zoneHint: 'On-premises', examNotes: ['Dedicated private link: consistent bandwidth and latency.', 'Weeks to provision. NOT encrypted by default (add VPN over DX or MACsec).', 'Preferred over VPN by BGP when both advertise the same prefix.'], concepts: ['direct-connect', 'hybrid-connectivity'] },
  backup: { type: 'backup', abbr: 'BAK', name: 'AWS Backup plan', category: 'storage', zoneHint: 'Region', examNotes: ['Central backup policies across RDS, DynamoDB, EFS, EBS, S3...', 'Cross-Region and cross-account copies.', 'Vault Lock (compliance mode) makes recovery points undeletable.'], concepts: ['aws-backup', 'dr-strategies'] },
  kinesis: { type: 'kinesis', abbr: 'KDS', name: 'Kinesis Data Streams', category: 'analytics', zoneHint: 'Region', examNotes: ['Shard: 1 MB/s or 1,000 records/s in, 2 MB/s out.', 'Ordered per partition key. Replay: 24 h default, up to 365 days.', 'Many consumers; enhanced fan-out gives each one 2 MB/s per shard.'], concepts: ['kinesis-data-streams'] },
  firehose: { type: 'firehose', abbr: 'KDF', name: 'Data Firehose', category: 'analytics', zoneHint: 'Region', examNotes: ['Fully managed delivery to S3, Redshift, OpenSearch, HTTP endpoints.', 'Near real time: buffers by size or time.', 'Can convert JSON to Parquet/ORC. No replay, no custom consumers.'], concepts: ['kinesis-firehose'] },
  athena: { type: 'athena', abbr: 'ATH', name: 'Athena', category: 'analytics', zoneHint: 'Region', examNotes: ['Serverless SQL on S3, $5 per TB scanned.', 'Columnar formats (Parquet) + partitioning cut the scan.', 'Schema in the Glue Data Catalog.'], concepts: ['athena-glue'] },
  snow: { type: 'snow', abbr: 'SNOW', name: 'Snowball Edge', category: 'storage', zoneHint: 'On-premises', examNotes: ['Offline transfer when the network would take weeks.', 'Rule of thumb: if it takes more than a week online, consider Snow.', 'Data is encrypted on the device.'], concepts: ['snow-family', 'data-migration'] },
  datasync: { type: 'datasync', abbr: 'DS', name: 'DataSync', category: 'storage', zoneHint: 'On-premises (agent)', examNotes: ['Online file/object transfer to S3, EFS, FSx; incremental and scheduled.', 'Verifies data; throttles bandwidth.', 'Storage Gateway is for ongoing hybrid access; DataSync is for moving data.'], concepts: ['datasync', 'data-migration'] },
  dms: { type: 'dms', abbr: 'DMS', name: 'Database Migration Service', category: 'database', zoneHint: 'Region', examNotes: ['Full load + change data capture (CDC) = near-zero downtime.', 'Heterogeneous migrations need the Schema Conversion Tool too.', 'Source stays live during the migration.'], concepts: ['dms', 'data-migration'] },
  rds: { type: 'rds', abbr: 'RDS', name: 'RDS database', category: 'database', zoneHint: 'Data subnets (≥ 2 AZs)', examNotes: ['HA / automatic failover / no data loss → Multi-AZ.', 'Read scaling → read replicas (async).', 'Encryption must be chosen at creation.'], concepts: ['rds-multi-az', 'rds-backups', 'rds-read-replicas'] },
};

export const CATEGORY_LABEL: Record<Category, string> = {
  compute: 'Compute',
  network: 'Networking',
  database: 'Database',
  storage: 'Storage',
  integration: 'Integration',
  security: 'Security',
  edge: 'Edge',
  analytics: 'Analytics',
  hybrid: 'Hybrid',
};
