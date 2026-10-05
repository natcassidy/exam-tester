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
      return `${cfg.instanceClass} · ${cfg.multiAz ? 'Multi-AZ' : 'Single-AZ'}`;
    case 's3':
      return `${cfg.blockPublicAccess ? 'BPA on' : 'BPA OFF'} · ${cfg.policy}`;
    case 'sqs':
      return `${cfg.fifo ? 'FIFO' : 'Standard'} · vis ${cfg.visibilityTimeoutSec}s${cfg.dlqId ? ' · DLQ' : ''}`;
    case 'lambda':
      return `${cfg.timeoutSec}s · ${cfg.reservedConcurrency === null ? 'unreserved' : `reserved ${cfg.reservedConcurrency}`}`;
    case 'apigw':
      return `→ ${cfg.integration.kind} ${ref(cfg.integration.targetId)}`;
    case 'dynamodb':
      return cfg.billingMode === 'onDemand' ? 'on-demand' : `${cfg.wcu} WCU / ${cfg.rcu} RCU`;
    case 'cloudfront':
      return `origin ${ref(cfg.originId)}${cfg.oac ? ' · OAC' : ''}`;
    case 'route53':
      return `alias → ${ref(cfg.aliasTargetId)}`;
    case 'waf':
      return `on ${ref(cfg.associatedId)}`;
    case 'vpce':
      return `${cfg.service} · ${cfg.routeTableIds.length} route table(s)`;
    case 'nat':
      return 'zonal · EIP';
    case 'igw':
      return 'attached';
  }
}
