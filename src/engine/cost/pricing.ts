// Single pricing table. Approximate us-east-1 on-demand prices (USD), checked against AWS
// public pricing pages in 2025-2026. They are labelled "approximate" in the UI.

import type { DbInstanceClass, InstanceType } from '../model';

export const HOURS_PER_MONTH = 730;

export const PRICING = {
  ec2Hourly: {
    't3.micro': 0.0104,
    't3.small': 0.0208,
    't3.medium': 0.0416,
    't3.large': 0.0832,
    'm5.large': 0.096,
    'c5.large': 0.085,
    'm5.xlarge': 0.192,
  } as Record<InstanceType, number>,
  rdsHourly: {
    'db.t3.micro': 0.017,
    'db.t3.medium': 0.068,
    'db.r5.large': 0.25,
    'db.r5.xlarge': 0.5,
  } as Record<DbInstanceClass, number>,
  rdsStorageGbMonth: 0.115, // gp2, Single-AZ (Multi-AZ doubles it)
  natHourly: 0.045,
  natPerGb: 0.045,
  albHourly: 0.0225,
  albLcuHourly: 0.008,
  publicIpv4Hourly: 0.005,
  dataOutPerGb: 0.09,
  crossAzPerGbEachWay: 0.01,
  s3StandardGbMonth: 0.023,
  s3GetPer1k: 0.0004,
  s3PutPer1k: 0.005,
  gatewayEndpoint: 0,
  interfaceEndpointHourlyPerAz: 0.01,
  interfaceEndpointPerGb: 0.01,
  sqsPerMillion: 0.4,
  lambdaPerMillion: 0.2,
  lambdaPerGbSecond: 0.0000166667,
  apigwRestPerMillion: 3.5,
  dynamoOnDemandWritePerMillion: 0.625,
  dynamoOnDemandReadPerMillion: 0.125,
  dynamoWcuHourly: 0.00065,
  dynamoRcuHourly: 0.00013,
  dynamoStorageGbMonth: 0.25,
  cloudfrontPerGb: 0.085,
  cloudfrontHttpsPer10k: 0.01,
  wafWebAclMonthly: 5,
  wafRuleMonthly: 1,
  wafPerMillion: 0.6,
  route53HostedZoneMonthly: 0.5,
  route53PerMillionQueries: 0.4,
} as const;

/** Requests per second an instance serves at 70% CPU in the capacity model. */
export const INSTANCE_RPS_AT_70: Record<InstanceType, number> = {
  't3.micro': 50,
  't3.small': 100,
  't3.medium': 200,
  't3.large': 400,
  'm5.large': 450,
  'c5.large': 500,
  'm5.xlarge': 900,
};

/** Queries per second and max connections in the capacity model. */
export const DB_CAPACITY: Record<DbInstanceClass, { qps: number; maxConnections: number }> = {
  'db.t3.micro': { qps: 400, maxConnections: 85 },
  'db.t3.medium': { qps: 2000, maxConnections: 410 },
  'db.r5.large': { qps: 6000, maxConnections: 1600 },
  'db.r5.xlarge': { qps: 12000, maxConnections: 3300 },
};

export const LAMBDA_ACCOUNT_CONCURRENCY = 1000;
export const LAMBDA_UNRESERVED_MINIMUM = 100;
export const APIGW_INTEGRATION_TIMEOUT_SEC = 29;
