import type { Board, Component } from '../../engine/model';

/** One-line config summary under a node name. */
export function nodeSubtitle(board: Board, c: Component): string {
  const cfg = c.config;
  const ref = (id: string | null) => (id && board.components[id]?.name) || '—';
  switch (cfg.type) {
    case 'alb':
      return `${cfg.listener.protocol}:${cfg.listener.port} → ${ref(cfg.targetId)}`;
    case 'asg':
      return `${cfg.desired}× ${cfg.instanceType} (${cfg.min}-${cfg.max})`;
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
  }
}
