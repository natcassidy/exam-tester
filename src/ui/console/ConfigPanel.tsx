import type { Component, DbInstanceClass, InstanceType, ScalingPolicy } from '../../engine/model';
import { componentsOfType, vpcOfComponent } from '../../engine/board';
import { HOURS_PER_MONTH, PRICING } from '../../engine/cost/pricing';
import { useGame } from '../../store/game';
import { bucketPolicyDoc } from '../../engine/iam/access';
import { NumberField, SelectField, TextField, Toggle } from './fields';
import { RefSelect, useUpdate } from './refs';
import { Stage3Config, Stage3Extras } from './Stage3Config';

export const INSTANCE_TYPES: InstanceType[] = ['t3.micro', 't3.small', 't3.medium', 't3.large', 'm5.large', 'm5a.large', 'm6i.large', 'c5.large', 'm5.xlarge'];
const DB_CLASSES: DbInstanceClass[] = ['db.t3.micro', 'db.t3.medium', 'db.r5.large', 'db.r5.xlarge'];
const usd = (n: number) => `≈ $${n.toFixed(2)}/mo (approx.)`;

function PolicyEditor({ policy, onChange }: { policy: ScalingPolicy; onChange: (p: ScalingPolicy) => void }) {
  return (
    <>
      <SelectField
        label="Scaling policy"
        value={policy.kind}
        options={[
          { value: 'none', label: 'None (fixed)' },
          { value: 'targetTracking', label: 'Target tracking (CPU)' },
          { value: 'step', label: 'Step scaling' },
          { value: 'scheduled', label: 'Scheduled' },
        ]}
        onChange={(k) =>
          onChange(
            k === 'targetTracking' ? { kind: k, targetCpu: 50 } : k === 'step' ? { kind: k, upperCpu: 70, addInstances: 2 } : k === 'scheduled' ? { kind: k, actions: [{ atMin: 10, desired: 8 }] } : { kind: 'none' },
          )
        }
      />
      {policy.kind === 'targetTracking' && <NumberField label="Target CPU" value={policy.targetCpu} min={10} max={95} suffix="%" onChange={(v) => onChange({ ...policy, targetCpu: v })} />}
      {policy.kind === 'step' && (
        <>
          <NumberField label="Alarm above CPU" value={policy.upperCpu} min={10} max={100} suffix="%" onChange={(v) => onChange({ ...policy, upperCpu: v })} />
          <NumberField label="Add instances" value={policy.addInstances} min={1} max={50} onChange={(v) => onChange({ ...policy, addInstances: v })} />
        </>
      )}
      {policy.kind === 'scheduled' && (
        <div className="section" style={{ marginTop: 6 }}>
          {policy.actions.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <span className="hint">At minute</span>
              <input type="number" value={a.atMin} min={0} onChange={(e) => onChange({ ...policy, actions: policy.actions.map((x, j) => (j === i ? { ...x, atMin: Number(e.target.value) } : x)) })} />
              <span className="hint">desired</span>
              <input type="number" value={a.desired} min={0} onChange={(e) => onChange({ ...policy, actions: policy.actions.map((x, j) => (j === i ? { ...x, desired: Number(e.target.value) } : x)) })} />
              <button className="btn ghost small" onClick={() => onChange({ ...policy, actions: policy.actions.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn small" onClick={() => onChange({ ...policy, actions: [...policy.actions, { atMin: 0, desired: 4 }] })}>
            + Scheduled action
          </button>
          <p className="hint">Minutes are relative to the start of each traffic event.</p>
        </div>
      )}
    </>
  );
}

function BucketPolicyView({ c }: { c: Component }) {
  const board = useGame((s) => s.board());
  const doc = bucketPolicyDoc(board, c);
  return <pre className="md" style={{ background: 'var(--bg-2)', padding: 8, borderRadius: 6, fontSize: 11, overflow: 'auto' }}>{doc ? JSON.stringify(doc, null, 2) : '// No bucket policy. Only principals with IAM permissions in this account can read.'}</pre>;
}

export function ConfigPanel({ c }: { c: Component }) {
  const update = useUpdate(c);
  const board = useGame((s) => s.board());
  const cfg = c.config;
  switch (cfg.type) {
    case 'alb':
      return (
        <>
          <SelectField label="Scheme" value={cfg.scheme} options={[{ value: 'internet-facing', label: 'Internet-facing' }, { value: 'internal', label: 'Internal' }]} onChange={(v) => update({ scheme: v })} />
          <SelectField label="Listener protocol" value={cfg.listener.protocol} options={[{ value: 'HTTPS', label: 'HTTPS' }, { value: 'HTTP', label: 'HTTP' }]} onChange={(v) => update({ listener: { ...cfg.listener, protocol: v } })} />
          <NumberField label="Listener port" value={cfg.listener.port} min={1} max={65535} onChange={(v) => update({ listener: { ...cfg.listener, port: v } })} />
          <RefSelect label="Target group" value={cfg.targetId} types={['asg', 'ec2']} onChange={(v) => update({ targetId: v })} />
          <NumberField label="Target port" value={cfg.targetPort} min={1} max={65535} onChange={(v) => update({ targetPort: v })} />
          <div className="section" style={{ marginTop: 10 }}>
            <h4>Health check</h4>
            <TextField label="Path" value={cfg.healthCheck.path} onChange={(v) => update({ healthCheck: { ...cfg.healthCheck, path: v } })} />
            <NumberField label="Interval" value={cfg.healthCheck.intervalSec} min={5} max={300} suffix="s" onChange={(v) => update({ healthCheck: { ...cfg.healthCheck, intervalSec: v } })} />
            <NumberField label="Timeout" value={cfg.healthCheck.timeoutSec} min={2} max={120} suffix="s" onChange={(v) => update({ healthCheck: { ...cfg.healthCheck, timeoutSec: v } })} />
            <NumberField label="Healthy threshold" value={cfg.healthCheck.healthyThreshold} min={2} max={10} onChange={(v) => update({ healthCheck: { ...cfg.healthCheck, healthyThreshold: v } })} />
            <NumberField label="Unhealthy threshold" value={cfg.healthCheck.unhealthyThreshold} min={2} max={10} onChange={(v) => update({ healthCheck: { ...cfg.healthCheck, unhealthyThreshold: v } })} />
            <p className="hint">Unhealthy after {cfg.healthCheck.intervalSec * cfg.healthCheck.unhealthyThreshold}s of failures.</p>
          </div>
          <Toggle label="Cross-zone load balancing" value={cfg.crossZone} onChange={(v) => update({ crossZone: v })} hint="Always on at the ALB level; configurable per target group." />
        </>
      );
    case 'ec2':
      return (
        <>
          <SelectField label="Instance type" value={cfg.instanceType} options={INSTANCE_TYPES.map((t) => ({ value: t, label: `${t} (${usd(PRICING.ec2Hourly[t] * HOURS_PER_MONTH)})` }))} onChange={(v) => update({ instanceType: v })} />
          <Toggle label="Auto-assign public IPv4" value={cfg.publicIp} onChange={(v) => update({ publicIp: v })} hint="≈ $3.65/month per address" />
          <TextField label="App health path" value={cfg.app.healthPath} onChange={(v) => update({ app: { ...cfg.app, healthPath: v } })} />
        </>
      );
    case 'asg':
      return (
        <>
          <SelectField label="Instance type" value={cfg.instanceType} options={INSTANCE_TYPES.map((t) => ({ value: t, label: `${t} (${usd(PRICING.ec2Hourly[t] * HOURS_PER_MONTH)})` }))} onChange={(v) => update({ instanceType: v })} />
          <NumberField label="Minimum" value={cfg.min} min={0} max={100} onChange={(v) => update({ min: v, desired: Math.max(v, cfg.desired), max: Math.max(v, cfg.max) })} />
          <NumberField label="Desired" value={cfg.desired} min={0} max={100} onChange={(v) => update({ desired: v })} />
          <NumberField label="Maximum" value={cfg.max} min={0} max={100} onChange={(v) => update({ max: v })} />
          <PolicyEditor policy={cfg.policy} onChange={(p) => update({ policy: p })} />
          <NumberField label="Instance warmup" value={cfg.warmupSec} min={0} max={3600} suffix="s" onChange={(v) => update({ warmupSec: v })} hint="New capacity serves after ~60 s boot + warmup" />
          <SelectField label="Health check type" value={cfg.healthCheckType} options={[{ value: 'EC2', label: 'EC2 (instance status)' }, { value: 'ELB', label: 'ELB (load balancer checks)' }]} onChange={(v) => update({ healthCheckType: v })} />
          <NumberField label="Health check grace" value={cfg.healthCheckGraceSec} min={0} max={7200} suffix="s" onChange={(v) => update({ healthCheckGraceSec: v })} />
          <Toggle label="Auto-assign public IPv4" value={cfg.publicIp} onChange={(v) => update({ publicIp: v })} />
          <TextField label="App health path" value={cfg.app.healthPath} onChange={(v) => update({ app: { ...cfg.app, healthPath: v } })} />
        </>
      );
    case 'rds':
      return (
        <>
          <SelectField label="Engine" value={cfg.engine} options={[{ value: 'mysql', label: 'MySQL (3306)' }, { value: 'postgres', label: 'PostgreSQL (5432)' }]} onChange={(v) => update({ engine: v, port: v === 'mysql' ? 3306 : 5432 })} />
          <SelectField label="Instance class" value={cfg.instanceClass} options={DB_CLASSES.map((t) => ({ value: t, label: `${t} (${usd(PRICING.rdsHourly[t] * HOURS_PER_MONTH)})` }))} onChange={(v) => update({ instanceClass: v })} />
          <Toggle label="Multi-AZ deployment" value={cfg.multiAz} onChange={(v) => update({ multiAz: v })} hint="Synchronous standby in another AZ, chosen automatically. Roughly doubles cost." />
          <NumberField label="Backup retention" value={cfg.backupRetentionDays} min={0} max={35} suffix="days" onChange={(v) => update({ backupRetentionDays: v })} />
          <NumberField label="Read replicas" value={cfg.readReplicas} min={0} max={15} onChange={(v) => update({ readReplicas: v })} />
          <Toggle label="Publicly accessible" value={cfg.publiclyAccessible} onChange={(v) => update({ publiclyAccessible: v })} />
          <Toggle label="Storage encrypted" value={cfg.storageEncrypted} onChange={(v) => update({ storageEncrypted: v })} hint="In AWS this can only be chosen at creation." />
          <NumberField label="Allocated storage" value={cfg.allocatedStorageGb} min={20} max={65536} suffix="GB" onChange={(v) => update({ allocatedStorageGb: v })} />
          <Stage3Extras c={c} />
        </>
      );
    case 's3':
      return (
        <>
          <Toggle label="Block Public Access (all four)" value={cfg.blockPublicAccess} onChange={(v) => update({ blockPublicAccess: v })} />
          <Toggle label="Versioning" value={cfg.versioning} onChange={(v) => update({ versioning: v })} />
          <SelectField label="Default encryption" value={cfg.encryption} options={[{ value: 'SSE-S3', label: 'SSE-S3' }, { value: 'SSE-KMS', label: 'SSE-KMS' }]} onChange={(v) => update({ encryption: v })} />
          <Toggle label="Static website hosting" value={cfg.staticWebsite} onChange={(v) => update({ staticWebsite: v })} />
          <SelectField
            label="Bucket policy"
            value={cfg.policy}
            options={[
              { value: 'none', label: 'No policy' },
              { value: 'public-read', label: 'Public read (Principal: *)' },
              { value: 'cloudfront-oac', label: 'CloudFront OAC only' },
              ...(cfg.policy === 'custom' ? [{ value: 'custom' as const, label: 'Custom (edited JSON)' }] : []),
            ]}
            onChange={(v) => update({ policy: v, customPolicy: v === 'custom' ? cfg.customPolicy : null, policyDistributionId: v === 'cloudfront-oac' ? (cfg.policyDistributionId ?? componentsOfType(board, 'cloudfront')[0]?.id ?? null) : null })}
            hint="Presets below. Edit the JSON on the Permissions tab."
          />
          {cfg.policy === 'cloudfront-oac' && <RefSelect label="Distribution (AWS:SourceArn)" value={cfg.policyDistributionId} types={['cloudfront']} onChange={(v) => update({ policyDistributionId: v })} />}
          <BucketPolicyView c={c} />
          <Stage3Extras c={c} />
        </>
      );
    case 'sqs':
      return (
        <>
          <SelectField label="Type" value={cfg.fifo ? 'fifo' : 'standard'} options={[{ value: 'standard', label: 'Standard (at-least-once)' }, { value: 'fifo', label: 'FIFO (exactly-once, ordered)' }]} onChange={(v) => update({ fifo: v === 'fifo' })} />
          <NumberField label="Visibility timeout" value={cfg.visibilityTimeoutSec} min={0} max={43200} suffix="s" onChange={(v) => update({ visibilityTimeoutSec: v })} />
          <NumberField label="Message retention" value={cfg.retentionSec} min={60} max={1209600} suffix="s" onChange={(v) => update({ retentionSec: v })} hint={`${(cfg.retentionSec / 86400).toFixed(1)} days`} />
          <RefSelect label="Dead-letter queue" value={cfg.dlqId} types={['sqs']} exclude={c.id} onChange={(v) => update({ dlqId: v })} />
          {cfg.dlqId && <NumberField label="maxReceiveCount" value={cfg.maxReceiveCount} min={1} max={1000} onChange={(v) => update({ maxReceiveCount: v })} />}
          <Toggle label="Server-side encryption" value={cfg.sse} onChange={(v) => update({ sse: v })} />
        </>
      );
    case 'lambda':
      return (
        <>
          <NumberField label="Memory" value={cfg.memoryMb} min={128} max={10240} step={64} suffix="MB" onChange={(v) => update({ memoryMb: v })} />
          <NumberField label="Timeout" value={cfg.timeoutSec} min={1} max={900} suffix="s" onChange={(v) => update({ timeoutSec: v })} />
          <label className="field">
            <span>
              Reserved concurrency
              <div className="hint">Blank = unreserved (shares the 1,000 account pool)</div>
            </span>
            <input
              type="number"
              min={0}
              max={900}
              defaultValue={cfg.reservedConcurrency ?? ''}
              key={String(cfg.reservedConcurrency)}
              onBlur={(e) => update({ reservedConcurrency: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
          <RefSelect label="Event source (SQS or Kinesis)" value={cfg.eventSourceId} types={['sqs', 'kinesis']} onChange={(v) => update({ eventSourceId: v })} />
          <Stage3Extras c={c} />
        </>
      );
    case 'apigw':
      return (
        <>
          <SelectField label="Integration" value={cfg.integration.kind} options={[{ value: 'lambda', label: 'Lambda (synchronous)' }, { value: 'sqs', label: 'SQS SendMessage (direct)' }]} onChange={(v) => update({ integration: { kind: v, targetId: null } })} />
          <RefSelect label="Integration target" value={cfg.integration.targetId} types={[cfg.integration.kind]} onChange={(v) => update({ integration: { ...cfg.integration, targetId: v } })} />
          <NumberField label="Throttle (steady)" value={cfg.throttleRps} min={1} max={10000} suffix="rps" onChange={(v) => update({ throttleRps: v })} />
          <p className="hint">Integration timeout: 29 s (default).</p>
        </>
      );
    case 'dynamodb':
      return (
        <>
          <SelectField label="Capacity mode" value={cfg.billingMode} options={[{ value: 'onDemand', label: 'On-demand' }, { value: 'provisioned', label: 'Provisioned' }]} onChange={(v) => update({ billingMode: v })} />
          {cfg.billingMode === 'provisioned' && (
            <>
              <NumberField label="Write capacity" value={cfg.wcu} min={1} suffix="WCU" onChange={(v) => update({ wcu: v })} />
              <NumberField label="Read capacity" value={cfg.rcu} min={1} suffix="RCU" onChange={(v) => update({ rcu: v })} />
            </>
          )}
          <Toggle label="Point-in-time recovery" value={cfg.pitr} onChange={(v) => update({ pitr: v })} />
          <Stage3Extras c={c} />
        </>
      );
    case 'cloudfront':
      return (
        <>
          <RefSelect label="Origin" value={cfg.originId} types={['s3', 'alb']} onChange={(v) => update({ originId: v })} />
          <Toggle label="Origin Access Control (OAC)" value={cfg.oac} onChange={(v) => update({ oac: v })} hint="Signs origin requests to S3 with SigV4" />
          <SelectField label="Viewer protocol" value={cfg.viewerProtocol} options={[{ value: 'redirect-to-https', label: 'Redirect HTTP to HTTPS' }, { value: 'https-only', label: 'HTTPS only' }, { value: 'allow-all', label: 'HTTP and HTTPS' }]} onChange={(v) => update({ viewerProtocol: v })} />
          <NumberField label="Expected cache hit ratio" value={Math.round(cfg.cacheHitRatio * 100)} min={0} max={100} suffix="%" onChange={(v) => update({ cacheHitRatio: v / 100 })} />
        </>
      );
    case 'route53':
      return (
        <>
          <TextField label="Record name" value={cfg.recordName} onChange={(v) => update({ recordName: v })} />
          <Stage3Extras c={c} />
        </>
      );
    case 'waf':
      return (
        <>
          <RefSelect label="Associated resource" value={cfg.associatedId} types={['cloudfront', 'alb', 'apigw']} onChange={(v) => update({ associatedId: v })} />
          <Toggle label="AWS managed rules (core rule set)" value={cfg.managedRules} onChange={(v) => update({ managedRules: v })} />
          <label className="field">
            <span>Rate limit per IP (5 min)</span>
            <input type="number" defaultValue={cfg.rateLimitPer5Min ?? ''} key={String(cfg.rateLimitPer5Min)} onBlur={(e) => update({ rateLimitPer5Min: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>
        </>
      );
    case 'vpce': {
      const vpc = vpcOfComponent(board, c);
      const rts = Object.values(board.routeTables).filter((r) => r.vpcId === vpc?.id);
      return (
        <>
          <SelectField label="Service" value={cfg.service} options={[{ value: 's3', label: 'com.amazonaws.us-east-1.s3' }, { value: 'dynamodb', label: 'com.amazonaws.us-east-1.dynamodb' }]} onChange={(v) => update({ service: v })} />
          <div className="section" style={{ marginTop: 10 }}>
            <h4>Associated route tables</h4>
            {rts.map((rt) => (
              <label key={rt.id} className="field">
                <span>{rt.name}</span>
                <input
                  type="checkbox"
                  checked={cfg.routeTableIds.includes(rt.id)}
                  onChange={(e) => update({ routeTableIds: e.target.checked ? [...cfg.routeTableIds, rt.id] : cfg.routeTableIds.filter((x) => x !== rt.id) })}
                />
              </label>
            ))}
            <p className="hint">Each associated table gets a route: {cfg.service === 's3' ? 'pl-s3' : 'pl-dynamodb'} → {c.name}. Gateway endpoints are free.</p>
          </div>
        </>
      );
    }
    case 'nat':
    case 'igw': {
      const rts = Object.values(board.routeTables).filter((rt) => rt.routes.some((r) => typeof r.target === 'object' && Object.values(r.target)[0] === c.id));
      return (
        <div className="section">
          <h4>Route tables using {c.name}</h4>
          {rts.length ? rts.map((rt) => <div key={rt.id} className="mono">{rt.name}</div>) : <p className="hint">No route table points here yet. Edit a route table (click a subnet) to add 0.0.0.0/0 → {c.name}.</p>}
          {cfg.type === 'nat' && <p className="hint">NAT gateways are zonal: point each AZ's private route table at the NAT in the same AZ.</p>}
        </div>
      );
    }
    default:
      return <Stage3Config c={c} />;
  }
}
