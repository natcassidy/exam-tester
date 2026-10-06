import type { Board, Component } from '../../engine/model';
import { subnetsOf } from '../../engine/board';

/** One-line config summary under a node name. */
export function nodeSubtitle(board: Board, c: Component): string {
  const cfg = c.config;
  const ref = (id: string | null) => (id && board.components[id]?.name) || '—';
  switch (cfg.type) {
    case 'alb':
      return `${cfg.listener.protocol}:${cfg.listener.port} → ${ref(cfg.targetId)}`;
    case 'asg':
      return `${cfg.desired}× ${cfg.instanceType} (${cfg.min}-${cfg.max})${cfg.purchase && cfg.purchase.spotPercent > 0 ? ` · Spot ${cfg.purchase.spotPercent}% above ${cfg.purchase.onDemandBase}` : ''}`;
    case 'ec2':
      return `${cfg.instanceType}${cfg.publicIp ? ' · public IP' : ''}`;
    case 'rds':
      return cfg.replicaOf ? `${cfg.instanceClass} · read replica of ${ref(cfg.replicaOf)}` : `${cfg.instanceClass} · ${cfg.multiAz ? 'Multi-AZ' : 'Single-AZ'}`;
    case 's3': {
      const extra = [cfg.versioning ? 'versioned' : '', cfg.objectLock && cfg.objectLock.mode !== 'none' ? `lock:${cfg.objectLock.mode}` : '', cfg.replication?.destId ? `→ ${ref(cfg.replication.destId)}` : '', cfg.lifecycle?.length ? `${cfg.lifecycle.length} transition(s)` : ''].filter(Boolean).join(' · ');
      return extra || `${cfg.blockPublicAccess ? 'BPA on' : 'BPA OFF'} · ${cfg.policy}`;
    }
    case 'sqs':
      return `${cfg.fifo ? 'FIFO' : 'Standard'} · vis ${cfg.visibilityTimeoutSec}s${cfg.dlqId ? ' · DLQ' : ''}`;
    case 'lambda':
      return `${cfg.timeoutSec}s · ${cfg.reservedConcurrency === null ? 'unreserved' : `reserved ${cfg.reservedConcurrency}`}`;
    case 'apigw':
      return `→ ${cfg.integration.kind} ${ref(cfg.integration.targetId)}`;
    case 'dynamodb':
      return `${cfg.billingMode === 'onDemand' ? 'on-demand' : `${cfg.wcu} WCU / ${cfg.rcu} RCU`}${cfg.replicaRegions?.length ? ` · global: +${cfg.replicaRegions.join(', ')}` : ''}${cfg.dax ? ' · DAX' : ''}`;
    case 'cloudfront':
      return `origin ${ref(cfg.originId)}${cfg.oac ? ' · OAC' : ''}`;
    case 'route53':
      return (cfg.policy ?? 'simple') === 'simple' ? `alias → ${ref(cfg.aliasTargetId)}` : `${cfg.policy} · ${(cfg.records ?? []).length} record(s)`;
    case 'waf':
      return `on ${ref(cfg.associatedId)}`;
    case 'vpce':
      return `${cfg.service} · ${cfg.routeTableIds.length} route table(s)`;
    case 'nat':
      return 'zonal · EIP';
    case 'igw':
      return 'attached';
    case 'aurora':
      return `${cfg.serverlessV2 ? `Serverless v2 ${cfg.minAcu}-${cfg.maxAcu} ACU` : cfg.instanceClass} · ${cfg.readers} reader(s)${cfg.globalPrimaryId ? ` · global secondary of ${ref(cfg.globalPrimaryId)}` : ''}`;
    case 'pcx':
      return cfg.peerVpcId ? `→ ${cfg.peerVpcId}` : 'no peer yet';
    case 'tgw':
      return `${cfg.vpcAttachments.length} VPC(s) · ${cfg.routeTables.length} route table(s)`;
    case 'vgw':
      return 'VPN / DX gateway';
    case 'cgw':
      return `ASN ${cfg.bgpAsn}`;
    case 'vpn':
      return `${ref(cfg.cgwId)} ↔ ${ref(cfg.attachTo)}`;
    case 'dx':
      return `${cfg.speedGbps} Gbps → ${ref(cfg.attachTo)}${cfg.encryption === 'none' ? '' : ` · ${cfg.encryption}`}`;
    case 'backup':
      return `every ${cfg.frequencyHours} h · ${cfg.resourceIds.length} resource(s)${cfg.copyRegion ? ` · copy → ${cfg.copyRegion}` : ''}`;
    case 'kinesis':
      return cfg.mode === 'onDemand' ? `on-demand · ${cfg.retentionHours} h` : `${cfg.shards} shard(s) · ${cfg.retentionHours} h`;
    case 'firehose':
      return `${ref(cfg.sourceId) === '—' ? 'Direct PUT' : ref(cfg.sourceId)} → ${ref(cfg.destId)} · ${cfg.format}`;
    case 'athena':
      return `queries ${ref(cfg.sourceId)}`;
    case 'snow':
      return `${cfg.devices} device(s) → ${ref(cfg.destId)}`;
    case 'datasync':
      return `${cfg.schedule} → ${ref(cfg.destId)}`;
    case 'dms':
      return `${cfg.mode} → ${ref(cfg.targetId)}`;
    case 'savings':
      return cfg.plan === 'compute-sp' || cfg.plan === 'ec2-instance-sp'
        ? `${cfg.plan === 'compute-sp' ? 'Compute SP' : `EC2 Instance SP (${cfg.instanceType.split('.')[0]})`} · $${cfg.hourlyCommit}/h · ${cfg.termYears} y`
        : `${cfg.count}× ${cfg.instanceType} ${cfg.plan === 'standard-ri' ? 'Standard' : 'Convertible'} RI · ${cfg.termYears} y`;
  }
}

/**
 * What a component placed in several subnets actually runs in one of them: an ALB node per subnet,
 * a share of the ASG's instances, the RDS primary or standby. `idle` marks a subnet the component
 * may use but runs nothing in today (the other half of a Single-AZ DB subnet group). `alone` means
 * the role already says everything the usual subtitle would.
 */
export function presenceIn(c: Component, subnetId: string): { role: string; idle?: boolean; alone?: boolean } | null {
  const subs = subnetsOf(c);
  if (subs.length < 2) return null;
  const i = subs.indexOf(subnetId);
  const cfg = c.config;
  switch (cfg.type) {
    case 'alb':
      return { role: 'node' };
    case 'asg': {
      const n = Math.floor(cfg.desired / subs.length) + (i < cfg.desired % subs.length ? 1 : 0);
      return n ? { role: `${n} of ${cfg.desired} × ${cfg.instanceType}`, alone: true } : { role: 'no instances', idle: true };
    }
    case 'rds':
      if (i === 0) return { role: 'primary' };
      return cfg.multiAz && !cfg.replicaOf && i === 1 ? { role: 'standby' } : { role: 'subnet group', idle: true };
    case 'aurora': {
      if (i === 0) return { role: 'writer' };
      const n = Math.floor(cfg.readers / (subs.length - 1)) + (i - 1 < cfg.readers % (subs.length - 1) ? 1 : 0);
      return n ? { role: n === 1 ? 'reader' : `${n} readers` } : { role: 'storage only', idle: true };
    }
    default:
      return { role: `${i + 1} of ${subs.length}` };
  }
}
