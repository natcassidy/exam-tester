import type { Concept } from '../engine/model';

// Concept IDs mapped to SAA-C03 task statements (Domain 1: 30%, 2: 26%, 3: 24%, 4: 20%).
export const CONCEPTS: Concept[] = [
  { id: 's3-block-public-access', title: 'S3 Block Public Access', domain: 'secure', task: '1.3' },
  { id: 's3-bucket-policy', title: 'S3 bucket policies', domain: 'secure', task: '1.1' },
  { id: 'cloudfront-oac', title: 'CloudFront Origin Access Control', domain: 'secure', task: '1.2' },
  { id: 'cloudfront-edge', title: 'CloudFront edge caching', domain: 'performant', task: '3.4' },
  { id: 'route53-alias', title: 'Route 53 alias records', domain: 'performant', task: '3.4' },
  { id: 'vpc-public-private', title: 'Public vs. private subnets', domain: 'secure', task: '1.2' },
  { id: 'internet-gateway', title: 'Internet gateways', domain: 'secure', task: '1.2' },
  { id: 'nat-gateway', title: 'NAT gateways', domain: 'resilient', task: '2.2' },
  { id: 'security-groups', title: 'Security groups', domain: 'secure', task: '1.2' },
  { id: 'nacls', title: 'Network ACLs', domain: 'secure', task: '1.2' },
  { id: 'sg-chaining', title: 'Security group chaining', domain: 'secure', task: '1.2' },
  { id: 'alb', title: 'Application Load Balancer', domain: 'resilient', task: '2.2' },
  { id: 'alb-health-checks', title: 'Target group health checks', domain: 'resilient', task: '2.2' },
  { id: 'asg-scaling', title: 'Auto Scaling policies and warmup', domain: 'performant', task: '3.2' },
  { id: 'static-stability', title: 'Static stability', domain: 'resilient', task: '2.2' },
  { id: 'rds-multi-az', title: 'RDS Multi-AZ', domain: 'resilient', task: '2.2' },
  { id: 'rds-backups', title: 'RDS backups and point-in-time restore', domain: 'resilient', task: '2.2' },
  { id: 'rds-read-replicas', title: 'RDS read replicas', domain: 'performant', task: '3.3' },
  { id: 'aws-waf', title: 'AWS WAF', domain: 'secure', task: '1.2' },
  { id: 'encryption-at-rest', title: 'Encryption at rest', domain: 'secure', task: '1.3' },
  { id: 'sqs-visibility-timeout', title: 'SQS visibility timeout', domain: 'resilient', task: '2.1' },
  { id: 'sqs-dlq', title: 'SQS dead-letter queues', domain: 'resilient', task: '2.1' },
  { id: 'lambda-concurrency', title: 'Lambda concurrency', domain: 'performant', task: '3.2' },
  { id: 'apigw-integrations', title: 'API Gateway integrations and limits', domain: 'resilient', task: '2.1' },
  { id: 'dynamodb-capacity', title: 'DynamoDB capacity modes', domain: 'performant', task: '3.3' },
  { id: 'vpc-gateway-endpoints', title: 'VPC gateway endpoints', domain: 'cost', task: '4.4' },
  { id: 'nat-data-processing', title: 'NAT gateway data processing charges', domain: 'cost', task: '4.4' },
  { id: 'data-transfer-costs', title: 'Data transfer pricing', domain: 'cost', task: '4.4' },
];

export const CONCEPT_BY_ID: Record<string, Concept> = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));
