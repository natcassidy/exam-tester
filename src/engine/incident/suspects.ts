// Suspects: every rule set, route and setting on a board that the player can point at as the
// root cause of an incident. Ids use the same keys as board diffs (diff.ts).

import type { Board, Component, ServiceType } from '../model';
import { allSubnets, targetLabel } from '../net/routing';
import { iamOf } from '../iam/access';

export interface Suspect {
  id: string;
  /** The object it belongs to, used to group the list (and to open it in the console). */
  objectId: string;
  group: string;
  label: string;
}

/** Settings worth diagnosing, per service. Field names match the config keys. */
export const DIAGNOSABLE: Partial<Record<ServiceType, { field: string; label: string }[]>> = {
  alb: [
    { field: 'healthCheck', label: 'Target group health check (path, interval, thresholds)' },
    { field: 'listener', label: 'Listener (port, protocol)' },
    { field: 'targetId', label: 'Target group registration' },
    { field: 'targetPort', label: 'Target port' },
    { field: 'scheme', label: 'Scheme (internet-facing / internal)' },
    { field: 'crossZone', label: 'Cross-zone load balancing' },
  ],
  asg: [
    { field: 'healthCheckType', label: 'Health check type (EC2 / ELB)' },
    { field: 'healthCheckGraceSec', label: 'Health check grace period' },
    { field: 'desired', label: 'Desired capacity' },
    { field: 'max', label: 'Maximum capacity' },
    { field: 'policy', label: 'Scaling policy' },
    { field: 'instanceType', label: 'Instance type' },
    { field: 'publicIp', label: 'Public IP assignment' },
  ],
  ec2: [
    { field: 'instanceType', label: 'Instance type' },
    { field: 'publicIp', label: 'Public IP assignment' },
  ],
  rds: [
    { field: 'multiAz', label: 'Multi-AZ' },
    { field: 'publiclyAccessible', label: 'Publicly accessible' },
    { field: 'port', label: 'Database port' },
    { field: 'backupRetentionDays', label: 'Backup retention' },
    { field: 'instanceClass', label: 'Instance class' },
  ],
  s3: [
    { field: 'encryption', label: 'Default encryption (SSE-S3 / SSE-KMS)' },
    { field: 'kmsKeyId', label: 'KMS key used for SSE-KMS' },
    { field: 'blockPublicAccess', label: 'Block Public Access' },
  ],
  sqs: [
    { field: 'visibilityTimeoutSec', label: 'Visibility timeout' },
    { field: 'dlqId', label: 'Dead-letter queue' },
  ],
  lambda: [
    { field: 'timeoutSec', label: 'Timeout' },
    { field: 'reservedConcurrency', label: 'Reserved concurrency' },
  ],
  apigw: [{ field: 'integration', label: 'Integration target' }],
  dynamodb: [{ field: 'billingMode', label: 'Capacity mode' }],
  vpce: [{ field: 'routeTableIds', label: 'Associated route tables' }],
};

const HAS_RESOURCE_POLICY: ServiceType[] = ['s3', 'sqs', 'vpce'];
const RUNS_AS_ROLE: ServiceType[] = ['ec2', 'asg', 'lambda'];

function componentSuspects(c: Component): Suspect[] {
  const group = `${c.name} (${c.type.toUpperCase()})`;
  const out: Suspect[] = (DIAGNOSABLE[c.type] ?? []).map((d) => ({ id: `config:${c.id}:${d.field}`, objectId: c.id, group, label: d.label }));
  if (HAS_RESOURCE_POLICY.includes(c.type)) out.push({ id: `resourcepolicy:${c.id}`, objectId: c.id, group, label: c.type === 's3' ? 'Bucket policy' : c.type === 'sqs' ? 'Queue policy' : 'Endpoint policy' });
  if (RUNS_AS_ROLE.includes(c.type)) out.push({ id: `role:${c.id}`, objectId: c.id, group, label: c.type === 'lambda' ? 'Attached execution role' : 'Attached instance profile (role)' });
  return out;
}

export function listSuspects(board: Board): Suspect[] {
  const out: Suspect[] = [];
  for (const c of Object.values(board.components)) out.push(...componentSuspects(c));
  for (const sg of Object.values(board.securityGroups)) {
    out.push({ id: `sg:${sg.id}:inbound`, objectId: sg.id, group: `Security group ${sg.name}`, label: 'Inbound rules' });
    out.push({ id: `sg:${sg.id}:outbound`, objectId: sg.id, group: `Security group ${sg.name}`, label: 'Outbound rules' });
  }
  for (const n of Object.values(board.nacls)) {
    out.push({ id: `nacl:${n.id}:inbound`, objectId: n.id, group: `Network ACL ${n.name}`, label: 'Inbound rules' });
    out.push({ id: `nacl:${n.id}:outbound`, objectId: n.id, group: `Network ACL ${n.name}`, label: 'Outbound rules' });
  }
  for (const rt of Object.values(board.routeTables))
    for (const r of rt.routes) out.push({ id: `route:${rt.id}:${r.dest}`, objectId: rt.id, group: `Route table ${rt.name}`, label: `Route ${r.dest} → ${r.target === 'local' ? 'local' : board.components[targetLabel(r.target).split(':')[1]]?.name ?? `${targetLabel(r.target)} (blackhole)`}` });
  for (const s of allSubnets(board)) {
    out.push({ id: `subnet:${s.id}:routeTableId`, objectId: s.id, group: `Subnet ${s.name}`, label: 'Route table association' });
    out.push({ id: `subnet:${s.id}:naclId`, objectId: s.id, group: `Subnet ${s.name}`, label: 'Network ACL association' });
  }
  const iam = iamOf(board);
  for (const r of Object.values(iam.roles)) {
    const group = `${r.kind === 'user' ? 'IAM user' : 'IAM role'} ${r.name}`;
    out.push({ id: `policy:${r.id}`, objectId: r.id, group, label: 'Permission policies (identity-based)' });
    if (r.boundary) out.push({ id: `boundary:${r.id}`, objectId: r.id, group, label: 'Permissions boundary' });
    if (r.kind === 'role') out.push({ id: `trust:${r.id}`, objectId: r.id, group, label: 'Trust policy' });
  }
  for (const k of Object.values(iam.keys)) out.push({ id: `keypolicy:${k.id}`, objectId: k.id, group: `KMS key ${k.alias}`, label: 'Key policy' });
  if (iam.scps.length) out.push({ id: 'scp', objectId: 'scp', group: 'AWS Organizations', label: 'Service control policies' });
  return out;
}
