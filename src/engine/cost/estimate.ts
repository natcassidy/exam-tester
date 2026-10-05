import type { Board, CostLineItem, UsageProfile } from '../model';
import { HOURS_PER_MONTH as H, PRICING as P } from './pricing';
import { subnetsOf } from '../board';
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
    if (monthly > 0.004) items.push({ service, item, monthly: r2(monthly), componentId });
  };
  const comps = Object.values(board.components);
  const avgRps = usage.requestsPerMonth / (H * 3600);
  let publicIps = 0;

  for (const c of comps) {
    const cfg = c.config;
    switch (cfg.type) {
      case 'ec2':
        add('EC2', `${c.name}: 1 × ${cfg.instanceType}`, P.ec2Hourly[cfg.instanceType] * H, c.id);
        if (cfg.publicIp) publicIps += 1;
        break;
      case 'asg':
        add('EC2', `${c.name}: ${cfg.desired} × ${cfg.instanceType} (desired capacity, on-demand)`, cfg.desired * P.ec2Hourly[cfg.instanceType] * H, c.id);
        if (cfg.publicIp) publicIps += cfg.desired;
        break;
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
      case 's3':
        add('S3', `${c.name}: ${usage.s3StorageGb.toLocaleString()} GB Standard`, usage.s3StorageGb * P.s3StandardGbMonth, c.id);
        add('S3', `${c.name}: requests`, (usage.s3GetRequests / 1000) * P.s3GetPer1k + (usage.s3PutRequests / 1000) * P.s3PutPer1k, c.id);
        break;
      case 'sqs':
        add('SQS', `${c.name}: requests`, ((usage.sqsRequests ?? 0) / 1e6) * P.sqsPerMillion, c.id);
        break;
      case 'lambda':
        add('Lambda', `${c.name}: requests + compute`, (usage.requestsPerMonth / 1e6) * P.lambdaPerMillion + (usage.lambdaGbSeconds ?? 0) * P.lambdaPerGbSecond, c.id);
        break;
      case 'apigw':
        add('API Gateway', `${c.name}: REST API requests`, (usage.requestsPerMonth / 1e6) * P.apigwRestPerMillion, c.id);
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
      case 'route53':
        add('Route 53', `${c.name}: hosted zone + queries`, P.route53HostedZoneMonthly + (usage.requestsPerMonth / 10 / 1e6) * P.route53PerMillionQueries, c.id);
        break;
      default:
        break;
    }
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

  if (publicIps) add('VPC', `${publicIps} public IPv4 address(es)`, publicIps * P.publicIpv4Hourly * H);

  const total = r2(items.reduce((s, i) => s + i.monthly, 0));
  return { total, items: items.sort((a, b) => b.monthly - a.monthly) };
}
