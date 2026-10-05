import type { ServiceType } from '../engine/model';

export type Category = 'compute' | 'network' | 'database' | 'storage' | 'integration' | 'security' | 'edge';

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
  route53: { type: 'route53', abbr: 'R53', name: 'Route 53', category: 'edge', zoneHint: 'Global edge', examNotes: ['Alias records work at the zone apex and are free for AWS targets.', 'Routing policies (latency, failover, weighted) arrive in Stage 3.'], concepts: ['route53-alias'] },
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
};
