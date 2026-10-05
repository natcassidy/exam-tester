import type { Board, Component, CostLineItem, UsageProfile } from '../model';
import { AURORA_QPS_PER_ACU, HOURS_PER_MONTH as H, PRICING as P, S3_CLASSES, SPOT_PRICE_RATIO } from './pricing';
import { applyCommitments, asgMix, boardEc2Usage, commitmentsOf, PLAN_LABEL } from './commitments';
import { componentsOfType, regionOf, subnetsOf } from '../board';
import { committedHourly as committedHourlyOf } from './commitments';
import { tgwAttachments } from '../net/trace';
import { traceFlow } from '../net/trace';
import { resolveEndpoint, resolveRef } from '../select';
import { findSubnet, INTERNET_IP, resolveRoute, targetId, targetKind } from '../net/routing';

export interface CostEstimate {
  total: number;
  items: CostLineItem[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function estimateCost(board: Board, usage: UsageProfile): CostEstimate {
  const items: CostLineItem[] = [];
  const add = (service: string, item: string, monthly: number, componentId?: string) => {
    if (monthly > 0.004 || monthly < -0.004) items.push({ service, item, monthly: r2(monthly), componentId });
  };
  const comps = Object.values(board.components);
  const avgRps = usage.requestsPerMonth / (H * 3600);
  let publicIps = 0;
  // The same API deployed in several Regions splits the traffic between them.
  const apiRegions = (type: 'apigw' | 'lambda') =>
    Math.max(1, new Set(comps.filter((c) => c.type === type && !(c.config.type === 'lambda' && c.config.eventSourceId)).map((c) => regionOf(board, c))).size);
  const share = (c: Component) => (c.config.type === 'lambda' && c.config.eventSourceId ? 1 : 1 / apiRegions(c.type as 'apigw' | 'lambda'));

  for (const c of comps) {
    const cfg = c.config;
    switch (cfg.type) {
      case 'ec2':
        add('EC2', `${c.name}: 1 × ${cfg.instanceType}`, P.ec2Hourly[cfg.instanceType] * H, c.id);
        if (cfg.publicIp) publicIps += 1;
        break;
      case 'asg': {
        const mix = asgMix(cfg);
        if (!cfg.purchase) add('EC2', `${c.name}: ${cfg.desired} × ${cfg.instanceType} (desired capacity, on-demand)`, cfg.desired * P.ec2Hourly[cfg.instanceType] * H, c.id);
        else {
          add('EC2', `${c.name}: ${mix.onDemand} × ${cfg.instanceType} On-Demand`, mix.onDemand * P.ec2Hourly[cfg.instanceType] * H, c.id);
          add('EC2', `${c.name}: ${mix.spot} Spot instance(s) (~${Math.round((1 - SPOT_PRICE_RATIO) * 100)}% below On-Demand, price varies)`, mix.spot * P.ec2Hourly[cfg.instanceType] * SPOT_PRICE_RATIO * H, c.id);
        }
        if (cfg.publicIp) publicIps += cfg.desired;
        break;
      }
      case 'alb': {
        const lcus = Math.max(1, avgRps / 25, usage.dataOutGb / (H * 1));
        add('ELB', `${c.name}: ALB hours`, P.albHourly * H, c.id);
        add('ELB', `${c.name}: ~${lcus.toFixed(1)} LCU (25 new conn/s or 1 GB/h each)`, lcus * P.albLcuHourly * H, c.id);
        if (cfg.scheme === 'internet-facing') publicIps += subnetsOf(c).length;
        break;
      }
      case 'nat':
        add('VPC', `${c.name}: NAT gateway hours`, P.natHourly * H, c.id);
        publicIps += 1;
        break;
      case 'rds': {
        const mult = cfg.multiAz ? 2 : 1;
        add('RDS', `${c.name}: ${cfg.instanceClass}${cfg.multiAz ? ' Multi-AZ (primary + standby)' : ' Single-AZ'}`, P.rdsHourly[cfg.instanceClass] * H * mult, c.id);
        add('RDS', `${c.name}: ${cfg.allocatedStorageGb} GB storage${cfg.multiAz ? ' × 2' : ''}`, cfg.allocatedStorageGb * P.rdsStorageGbMonth * mult, c.id);
        if (cfg.readReplicas) add('RDS', `${c.name}: ${cfg.readReplicas} read replica(s)`, cfg.readReplicas * (P.rdsHourly[cfg.instanceClass] * H + cfg.allocatedStorageGb * P.rdsStorageGbMonth), c.id);
        if (cfg.publiclyAccessible) publicIps += 1;
        break;
      }
      case 's3': {
        const cls = S3_CLASSES[cfg.storageClass ?? 'STANDARD'];
        add('S3', `${c.name}: ${usage.s3StorageGb.toLocaleString()} GB ${cls.label}`, usage.s3StorageGb * cls.gbMonth, c.id);
        add('S3', `${c.name}: requests`, (usage.s3GetRequests / 1000) * P.s3GetPer1k + (usage.s3PutRequests / 1000) * P.s3PutPer1k, c.id);
        break;
      }
      case 'sqs':
        add('SQS', `${c.name}: requests`, ((usage.sqsRequests ?? 0) / 1e6) * P.sqsPerMillion, c.id);
        break;
      case 'lambda':
        add('Lambda', `${c.name}: requests + compute`, ((usage.requestsPerMonth / 1e6) * P.lambdaPerMillion + (usage.lambdaGbSeconds ?? 0) * P.lambdaPerGbSecond) * share(c), c.id);
        break;
      case 'apigw':
        add('API Gateway', `${c.name}: REST API requests`, (usage.requestsPerMonth / 1e6) * P.apigwRestPerMillion * share(c), c.id);
        break;
      case 'dynamodb':
        if (cfg.billingMode === 'onDemand')
          add('DynamoDB', `${c.name}: on-demand reads/writes`, ((usage.dynamoWrites ?? 0) / 1e6) * P.dynamoOnDemandWritePerMillion + ((usage.dynamoReads ?? 0) / 1e6) * P.dynamoOnDemandReadPerMillion, c.id);
        else add('DynamoDB', `${c.name}: ${cfg.wcu} WCU / ${cfg.rcu} RCU provisioned`, (cfg.wcu * P.dynamoWcuHourly + cfg.rcu * P.dynamoRcuHourly) * H, c.id);
        add('DynamoDB', `${c.name}: storage`, (usage.dynamoStorageGb ?? 0) * P.dynamoStorageGbMonth, c.id);
        break;
      case 'cloudfront':
        add('CloudFront', `${c.name}: ${usage.dataOutGb.toLocaleString()} GB to viewers`, usage.dataOutGb * P.cloudfrontPerGb, c.id);
        add('CloudFront', `${c.name}: HTTPS requests`, (usage.requestsPerMonth / 10000) * P.cloudfrontHttpsPer10k, c.id);
        break;
      case 'waf':
        add('WAF', `${c.name}: web ACL + rules`, P.wafWebAclMonthly + (cfg.managedRules ? 1 : 0) * P.wafRuleMonthly + (cfg.rateLimitPer5Min ? 1 : 0) * P.wafRuleMonthly, c.id);
        add('WAF', `${c.name}: requests inspected`, (usage.requestsPerMonth / 1e6) * P.wafPerMillion, c.id);
        break;
      case 'route53': {
        const policy = cfg.policy ?? 'simple';
        const perM = ['latency', 'geolocation', 'geoproximity'].includes(policy) ? P.route53LatencyPerMillionQueries : P.route53PerMillionQueries;
        add('Route 53', `${c.name}: hosted zone + queries (${policy})`, P.route53HostedZoneMonthly + (usage.requestsPerMonth / 10 / 1e6) * perM, c.id);
        const hcs = policy === 'simple' ? 0 : (cfg.records ?? []).filter((r) => r.healthCheck).length;
        if (hcs) add('Route 53', `${c.name}: ${hcs} health check(s)${cfg.healthCheck?.intervalSec === 10 ? ' (fast 10 s interval)' : ''}`, hcs * (P.route53HealthCheckMonthly + (cfg.healthCheck?.intervalSec === 10 ? P.route53FastIntervalMonthly : 0)), c.id);
        break;
      }
      case 'aurora': {
        const instances = 1 + cfg.readers;
        if (cfg.serverlessV2) {
          // With a known average load, capacity follows it (at ~70% utilisation); otherwise assume a quarter of max.
          const acu = usage.dbAvgQps !== undefined ? Math.min(cfg.maxAcu, Math.max(cfg.minAcu, Math.round((usage.dbAvgQps / AURORA_QPS_PER_ACU / 0.7) * 2) / 2)) : Math.max(cfg.minAcu, cfg.maxAcu / 4);
          add('Aurora', `${c.name}: Serverless v2, ~${acu} ACU average × ${instances} instance(s)`, acu * P.auroraAcuHourly * H * instances, c.id);
        } else add('Aurora', `${c.name}: ${instances} × ${cfg.instanceClass} (writer${cfg.readers ? ` + ${cfg.readers} reader(s)` : ''})`, instances * P.auroraHourly[cfg.instanceClass] * H, c.id);
        if (!cfg.globalPrimaryId) add('Aurora', `${c.name}: ${(usage.rdsStorageGb ?? 100).toLocaleString()} GB cluster storage`, (usage.rdsStorageGb ?? 100) * P.auroraStorageGbMonth, c.id);
        else add('Aurora', `${c.name}: secondary storage + replicated writes`, (usage.rdsStorageGb ?? 100) * P.auroraStorageGbMonth, c.id);
        break;
      }
      case 'tgw': {
        const n = tgwAttachments(board, c).length;
        add('Transit Gateway', `${c.name}: ${n} attachment(s) × $${P.tgwAttachmentHourly}/h`, n * P.tgwAttachmentHourly * H, c.id);
        add('Transit Gateway', `${c.name}: ${(usage.interVpcGb ?? 0).toLocaleString()} GB processed`, (usage.interVpcGb ?? 0) * P.tgwPerGb, c.id);
        break;
      }
      case 'pcx':
        // Peering itself is free; data crossing AZs (or Regions) is charged as normal transfer.
        add('VPC', `${c.name}: data over the peering connection (cross-AZ share)`, ((usage.interVpcGb ?? 0) / Math.max(1, Object.values(board.components).filter((x) => x.type === 'pcx').length)) * P.crossAzPerGbEachWay, c.id);
        break;
      case 'vpn':
        add('VPN', `${c.name}: Site-to-Site VPN connection hours`, P.vpnConnectionHourly * H, c.id);
        break;
      case 'dx':
        add('Direct Connect', `${c.name}: ${cfg.speedGbps} Gbps dedicated port hours`, P.dxPortHourly[cfg.speedGbps] * H, c.id);
        break;
      case 'backup': {
        const gb = (usage.backupGb ?? 100) * cfg.resourceIds.length;
        add('AWS Backup', `${c.name}: ~${gb.toLocaleString()} GB of recovery points`, gb * P.backupGbMonth, c.id);
        if (cfg.copyRegion) add('AWS Backup', `${c.name}: copies in ${cfg.copyRegion} (storage + inter-Region transfer)`, gb * (P.backupGbMonth + P.interRegionPerGb), c.id);
        break;
      }
      case 'kinesis': {
        const eps = usage.streamEventsPerSec ?? 0;
        const kb = usage.streamAvgKb ?? 1;
        const gbIn = (eps * kb * 3600 * H) / 1e6;
        const consumers = Object.values(board.components).filter((x) => (x.config.type === 'lambda' && x.config.eventSourceId === c.id) || (x.config.type === 'firehose' && x.config.sourceId === c.id));
        if (cfg.mode === 'onDemand') {
          add('Kinesis', `${c.name}: on-demand stream hours`, P.kinesisOnDemandStreamHourly * H, c.id);
          add('Kinesis', `${c.name}: ${Math.round(gbIn).toLocaleString()} GB ingested (on-demand)`, gbIn * P.kinesisOnDemandInPerGb, c.id);
          add('Kinesis', `${c.name}: ${consumers.length} consumer(s) reading`, gbIn * consumers.length * P.kinesisOnDemandOutPerGb, c.id);
        } else {
          add('Kinesis', `${c.name}: ${cfg.shards} shard(s)`, cfg.shards * P.kinesisShardHourly * H, c.id);
          add('Kinesis', `${c.name}: PUT payload units (25 KB each)`, ((eps * Math.ceil(kb / 25) * 3600 * H) / 1e6) * P.kinesisPutUnitsPerMillion, c.id);
        }
        if (cfg.retentionHours > 24) add('Kinesis', `${c.name}: extended retention (${cfg.retentionHours} h)`, (cfg.mode === 'onDemand' ? 1 : cfg.shards) * 0.02 * H, c.id);
        const efo = consumers.filter((x) => x.config.type === 'lambda' && x.config.enhancedFanOut).length;
        const shards = cfg.mode === 'onDemand' ? Math.ceil((eps * kb) / 1000) : cfg.shards;
        if (efo) add('Kinesis', `${c.name}: ${efo} enhanced fan-out consumer(s)`, efo * (shards * P.kinesisEfoShardHourly * H + gbIn * P.kinesisEfoPerGb), c.id);
        break;
      }
      case 'firehose': {
        const eps = usage.streamEventsPerSec ?? 0;
        const kb = usage.streamAvgKb ?? 1;
        const billedGb = (eps * Math.ceil(kb / 5) * 5 * 3600 * H) / 1e6;
        const realGb = (eps * kb * 3600 * H) / 1e6;
        add('Firehose', `${c.name}: ${Math.round(billedGb).toLocaleString()} GB ingested (each record rounded up to 5 KB)`, billedGb * P.firehosePerGb, c.id);
        if (cfg.format === 'parquet') add('Firehose', `${c.name}: format conversion to Parquet`, realGb * P.firehoseFormatConversionPerGb, c.id);
        break;
      }
      case 'athena': {
        const src = cfg.sourceId ? board.components[cfg.sourceId] : undefined;
        const parquet = Object.values(board.components).some((x) => x.config.type === 'firehose' && x.config.destId === src?.id && x.config.format === 'parquet');
        const tb = (usage.athenaJsonTbScanned ?? 0) * (parquet ? 0.1 : 1);
        add('Athena', `${c.name}: ${tb.toFixed(1)} TB scanned (${parquet ? 'Parquet: only the needed columns, compressed' : 'JSON: every byte of every row'})`, tb * P.athenaPerTb, c.id);
        break;
      }
      case 'snow':
        add('Snowball', `${c.name}: ${cfg.devices} device job(s) (one-time)`, cfg.devices * P.snowballJob, c.id);
        break;
      case 'datasync': {
        // With a Snowball job carrying the bulk, DataSync only copies what changed since.
        const bulkBySnow = comps.some((x) => x.config.type === 'snow' && x.config.destId);
        const gb = bulkBySnow ? (usage.migrationChangeGb ?? 0) : (usage.migrationTb ?? 0) * 1000 + (usage.migrationChangeGb ?? 0);
        add('DataSync', `${c.name}: ${Math.round(gb).toLocaleString()} GB copied${bulkBySnow ? ' (changes only; the Snowball job carries the bulk)' : ''}`, gb * P.datasyncPerGb, c.id);
        break;
      }
        break;
      case 'dms':
        add('DMS', `${c.name}: replication instance (dms.t3.medium)`, P.dmsInstanceHourly * H, c.id);
        break;
      default:
        break;
    }
    if (cfg.type === 'dynamodb') {
      const replicas = cfg.replicaRegions ?? [];
      if (replicas.length) {
        add('DynamoDB', `${c.name}: replicated writes to ${replicas.join(', ')}`, replicas.length * ((usage.dynamoWrites ?? 0) / 1e6) * P.dynamoReplicatedWritePerMillion, c.id);
        add('DynamoDB', `${c.name}: replica storage`, replicas.length * (usage.dynamoStorageGb ?? 0) * P.dynamoStorageGbMonth, c.id);
      }
      if (cfg.dax) add('DynamoDB', `${c.name}: DAX, 3 × dax.t3.medium in each of ${1 + replicas.length} Region(s)`, 3 * (1 + replicas.length) * P.daxNodeHourly * H, c.id);
    }
  }

  // Data that crosses Regions (replication, DR copies).
  const multiRegion = new Set(comps.map((c) => regionOf(board, c)).filter((r) => r !== 'global' && r !== 'onprem')).size > 1;
  if (multiRegion && usage.crossRegionGb) add('Data transfer', `${usage.crossRegionGb.toLocaleString()} GB replicated between Regions`, usage.crossRegionGb * P.interRegionPerGb);
  if (usage.hybridOutGb) {
    const dx = comps.find((c) => c.type === 'dx');
    if (dx) add('Data transfer', `${usage.hybridOutGb.toLocaleString()} GB out to on-premises over Direct Connect`, usage.hybridOutGb * P.dxOutPerGb, dx.id);
    else if (comps.some((c) => c.type === 'vpn')) add('Data transfer', `${usage.hybridOutGb.toLocaleString()} GB out to on-premises over the VPN (internet rates)`, usage.hybridOutGb * P.dataOutPerGb);
  }

  // Data served straight from the VPC to the internet (no CloudFront in front).
  const hasCdn = comps.some((c) => c.type === 'cloudfront');
  const entry = comps.find((c) => c.type === 'alb') ?? comps.find((c) => c.type === 'apigw') ?? comps.find((c) => c.type === 's3' && c.config.type === 's3' && c.config.policy === 'public-read');
  if (!hasCdn && entry && usage.dataOutGb > 0) add('Data transfer', `Out to the internet from ${entry.name}`, usage.dataOutGb * P.dataOutPerGb, entry.id);

  // Flows from the usage profile follow the board's real routes. They describe data fetched into
  // the VPC (downloads): inbound transfer is free, but a NAT gateway charges per GB it processes.
  for (const f of usage.flows) {
    const src = resolveRef(board, f.from);
    const to = resolveEndpoint(board, f.to);
    if (!src || !to) continue;
    const t = traceFlow(board, { from: src.id, to, protocol: 'tcp', port: 443 });
    const paths = t.paths ?? [{ subnetId: src.placement.refId, result: t.result, via: t.via }];
    const share = f.gbPerMonth / paths.length;
    for (const p of paths) {
      if (p.result !== 'delivered') continue;
      const label = `${src.name} → ${f.to === 'svc:s3' ? 'S3' : f.to}`;
      const subnet = findSubnet(board, p.subnetId)?.subnet;
      if (p.via === 'nat') {
        const rt = subnet ? resolveRoute(board, subnet.routeTableId, f.to === 'internet' ? INTERNET_IP : '52.216.10.20') : null;
        const nat = rt && targetKind(rt.route.target) === 'nat' ? board.components[targetId(rt.route.target)!] : undefined;
        add('VPC', `NAT data processing: ${label} from ${subnet?.name} (${share.toLocaleString()} GB via ${nat?.name ?? 'NAT'})`, share * P.natPerGb, nat?.id);
        const natAz = nat ? findSubnet(board, nat.placement.refId)?.subnet.azId : undefined;
        if (natAz && subnet && natAz !== subnet.azId) add('Data transfer', `Cross-AZ: ${subnet.name} → ${nat!.name}`, share * P.crossAzPerGbEachWay * 2, nat!.id);
      }
    }
  }

  // Savings Plans / Reserved Instances: pay the commitment, minus the On-Demand usage it covers.
  const commits = commitmentsOf(board);
  if (commits.length) {
    const hour = applyCommitments(commits, { ec2: boardEc2Usage(board), lambdaOdHourly: 0 });
    const covered = hour.onDemand - (hour.cost - hour.committed);
    for (const c of componentsOfType(board, 'savings')) add('Commitments', `${c.name}: ${PLAN_LABEL[c.config.plan]}, ${c.config.termYears}-year term`, committedHourlyOf(c.config) * H, c.id);
    add('Commitments', 'On-Demand usage covered by commitments', -covered * H);
  }

  if (publicIps) add('VPC', `${publicIps} public IPv4 address(es)`, publicIps * P.publicIpv4Hourly * H);

  const total = r2(items.reduce((s, i) => s + i.monthly, 0));
  return { total, items: items.sort((a, b) => b.monthly - a.monthly) };
}
