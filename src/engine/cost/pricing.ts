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
  // ----- Stage 3 -----
  route53LatencyPerMillionQueries: 0.6,
  route53HealthCheckMonthly: 0.5,
  route53FastIntervalMonthly: 1,
  interRegionPerGb: 0.02,
  tgwAttachmentHourly: 0.05,
  tgwPerGb: 0.02,
  vpnConnectionHourly: 0.05,
  dxPortHourly: { 1: 0.3, 10: 2.25, 100: 22.5 } as Record<1 | 10 | 100, number>,
  dxOutPerGb: 0.02,
  auroraHourly: { 'db.r6g.large': 0.26, 'db.r6g.xlarge': 0.519, 'db.r6g.2xlarge': 1.038 } as Record<string, number>,
  auroraAcuHourly: 0.12,
  auroraStorageGbMonth: 0.1,
  auroraReplicatedWritePerMillion: 0.2,
  dynamoReplicatedWritePerMillion: 0.625,
  daxNodeHourly: 0.08,
  backupGbMonth: 0.05,
  kinesisShardHourly: 0.015,
  kinesisPutUnitsPerMillion: 0.014,
  kinesisEfoShardHourly: 0.015,
  kinesisEfoPerGb: 0.013,
  kinesisOnDemandStreamHourly: 0.04,
  kinesisOnDemandInPerGb: 0.08,
  kinesisOnDemandOutPerGb: 0.04,
  firehosePerGb: 0.029,
  firehoseFormatConversionPerGb: 0.018,
  athenaPerTb: 5,
  snowballJob: 300,
  datasyncPerGb: 0.0125,
  dmsInstanceHourly: 0.073,
} as const;

/** S3 storage classes (approximate us-east-1): storage per GB-month, retrieval per GB, minimum storage days, first-byte latency, lifecycle transition cost per 1,000 objects. */
export const S3_CLASSES: Record<
  'STANDARD' | 'INTELLIGENT_TIERING' | 'STANDARD_IA' | 'ONEZONE_IA' | 'GLACIER_IR' | 'GLACIER' | 'DEEP_ARCHIVE',
  { label: string; gbMonth: number; retrievalPerGb: number; minDays: number; firstByteSec: number; firstByte: string; transitionPer1k: number; azs: number }
> = {
  STANDARD: { label: 'S3 Standard', gbMonth: 0.023, retrievalPerGb: 0, minDays: 0, firstByteSec: 0.1, firstByte: 'milliseconds', transitionPer1k: 0, azs: 3 },
  INTELLIGENT_TIERING: { label: 'S3 Intelligent-Tiering', gbMonth: 0.023, retrievalPerGb: 0, minDays: 0, firstByteSec: 0.1, firstByte: 'milliseconds (default tiers)', transitionPer1k: 0.01, azs: 3 },
  STANDARD_IA: { label: 'S3 Standard-IA', gbMonth: 0.0125, retrievalPerGb: 0.01, minDays: 30, firstByteSec: 0.1, firstByte: 'milliseconds', transitionPer1k: 0.01, azs: 3 },
  ONEZONE_IA: { label: 'S3 One Zone-IA', gbMonth: 0.01, retrievalPerGb: 0.01, minDays: 30, firstByteSec: 0.1, firstByte: 'milliseconds', transitionPer1k: 0.01, azs: 1 },
  GLACIER_IR: { label: 'S3 Glacier Instant Retrieval', gbMonth: 0.004, retrievalPerGb: 0.03, minDays: 90, firstByteSec: 0.1, firstByte: 'milliseconds', transitionPer1k: 0.02, azs: 3 },
  GLACIER: { label: 'S3 Glacier Flexible Retrieval', gbMonth: 0.0036, retrievalPerGb: 0.01, minDays: 90, firstByteSec: 5 * 3600, firstByte: '3-5 hours (standard), 1-5 minutes (expedited)', transitionPer1k: 0.03, azs: 3 },
  DEEP_ARCHIVE: { label: 'S3 Glacier Deep Archive', gbMonth: 0.00099, retrievalPerGb: 0.02, minDays: 180, firstByteSec: 12 * 3600, firstByte: 'within 12 hours (standard), 48 hours (bulk)', transitionPer1k: 0.05, azs: 3 },
};

/** Intelligent-Tiering: objects not accessed for 30 days move to Infrequent Access, after 90 days to Archive Instant Access. */
export const S3_INTELLIGENT = { infrequentGbMonth: 0.0125, archiveInstantGbMonth: 0.004, monitoringPer1kObjects: 0.0025 };

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
