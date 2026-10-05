// Config panels for the Stage 3 services, plus the Stage 3 fields of earlier services
// (RDS replicas, S3 lifecycle and protection, DynamoDB global tables, Route 53 policies).

import type { Component, ConfigOf, LifecycleTransition, Route53Policy, Route53Record, S3StorageClass, TgwRouteTable } from '../../engine/model';
import { regionOf, vpcOfComponent } from '../../engine/board';
import { allVpcs } from '../../engine/net/routing';
import { tgwAttachments } from '../../engine/net/trace';
import { S3_CLASSES } from '../../engine/cost/pricing';
import { useGame } from '../../store/game';
import { NumberField, SelectField, TextField, Toggle } from './fields';
import { RefSelect, useUpdate } from './refs';

const CLASSES = Object.keys(S3_CLASSES) as S3StorageClass[];
const classOptions = CLASSES.map((k) => ({ value: k, label: `${S3_CLASSES[k].label} ($${S3_CLASSES[k].gbMonth}/GB-mo, ${S3_CLASSES[k].firstByte})` }));

function Checks({ title, items, selected, onChange, hint }: { title: string; items: { id: string; label: string }[]; selected: string[]; onChange: (ids: string[]) => void; hint?: string }) {
  return (
    <div className="section" style={{ marginTop: 10 }}>
      <h4>{title}</h4>
      {items.length === 0 && <p className="hint">Nothing to choose from yet.</p>}
      {items.map((it) => (
        <label key={it.id} className="field">
          <span>{it.label}</span>
          <input type="checkbox" checked={selected.includes(it.id)} onChange={(e) => onChange(e.target.checked ? [...selected, it.id] : selected.filter((x) => x !== it.id))} />
        </label>
      ))}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

function LifecycleEditor({ cfg, update }: { cfg: ConfigOf<'s3'>; update: (p: Record<string, unknown>) => void }) {
  const lc = cfg.lifecycle ?? [];
  const set = (next: LifecycleTransition[]) => update({ lifecycle: next });
  return (
    <div className="section" style={{ marginTop: 10 }}>
      <h4>Lifecycle rule</h4>
      {lc.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
          <span className="hint">After</span>
          <input type="number" min={0} style={{ width: 70 }} defaultValue={t.afterDays} key={`${i}-${t.afterDays}`} onBlur={(e) => set(lc.map((x, j) => (j === i ? { ...x, afterDays: Number(e.target.value) } : x)))} />
          <span className="hint">days →</span>
          <select value={t.toClass} onChange={(e) => set(lc.map((x, j) => (j === i ? { ...x, toClass: e.target.value as S3StorageClass } : x)))}>
            {CLASSES.filter((k) => k !== 'STANDARD').map((k) => (
              <option key={k} value={k}>
                {S3_CLASSES[k].label}
              </option>
            ))}
          </select>
          <button className="btn ghost small" onClick={() => set(lc.filter((_, j) => j !== i))} aria-label="Remove transition">
            ✕
          </button>
        </div>
      ))}
      <button className="btn small" onClick={() => set([...lc, { afterDays: (lc[lc.length - 1]?.afterDays ?? 0) + 30, toClass: 'STANDARD_IA' }])}>
        + Transition
      </button>
      <label className="field" style={{ marginTop: 6 }}>
        <span>
          Expire objects after
          <div className="hint">Blank = keep forever</div>
        </span>
        <span>
          <input
            type="number"
            min={1}
            defaultValue={cfg.expireAfterDays ?? ''}
            key={String(cfg.expireAfterDays)}
            onBlur={(e) => update({ expireAfterDays: e.target.value === '' ? null : Number(e.target.value) })}
          />
          <span className="hint"> days</span>
        </span>
      </label>
    </div>
  );
}

const POLICY_LABEL: Record<Route53Policy, string> = {
  simple: 'Simple (one target, no health checks)',
  failover: 'Failover (primary / secondary)',
  weighted: 'Weighted',
  latency: 'Latency-based',
  geolocation: 'Geolocation',
  geoproximity: 'Geoproximity',
  multivalue: 'Multivalue answer',
};
const LOCATIONS = [
  { value: '*', label: 'Default (*)' },
  { value: 'NA', label: 'North America' },
  { value: 'SA', label: 'South America' },
  { value: 'EU', label: 'Europe' },
  { value: 'AS', label: 'Asia' },
  { value: 'OC', label: 'Oceania' },
  { value: 'AF', label: 'Africa' },
];

function Route53Fields({ c, cfg, update }: { c: Component; cfg: ConfigOf<'route53'>; update: (p: Record<string, unknown>) => void }) {
  const board = useGame((s) => s.board());
  const policy = cfg.policy ?? 'simple';
  const records = cfg.records ?? [];
  const targets = Object.values(board.components).filter((x) => ['alb', 'cloudfront', 'apigw', 's3', 'ec2'].includes(x.type));
  const setRecords = (next: Route53Record[]) => update({ records: next });
  const patchRec = (i: number, p: Partial<Route53Record>) => setRecords(records.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <>
      <SelectField label="Routing policy" value={policy} options={(Object.keys(POLICY_LABEL) as Route53Policy[]).map((k) => ({ value: k, label: POLICY_LABEL[k] }))} onChange={(v) => update({ policy: v })} />
      {policy === 'simple' ? (
        <RefSelect label="Alias target" value={cfg.aliasTargetId} types={['cloudfront', 'alb', 's3', 'apigw']} onChange={(v) => update({ aliasTargetId: v })} />
      ) : (
        <div className="section" style={{ marginTop: 10 }}>
          <h4>Records</h4>
          {records.map((r, i) => (
            <div key={r.id} className="card-row" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <select value={r.targetId ?? ''} onChange={(e) => patchRec(i, { targetId: e.target.value || null })} aria-label="Record target">
                <option value="">— target —</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({regionOf(board, t)})
                  </option>
                ))}
              </select>
              {policy === 'failover' && (
                <select value={r.failover ?? 'primary'} onChange={(e) => patchRec(i, { failover: e.target.value as 'primary' | 'secondary' })} aria-label="Failover role">
                  <option value="primary">Primary</option>
                  <option value="secondary">Secondary</option>
                </select>
              )}
              {policy === 'weighted' && <input type="number" min={0} max={255} style={{ width: 60 }} defaultValue={r.weight ?? 1} key={`w${r.weight}`} onBlur={(e) => patchRec(i, { weight: Number(e.target.value) })} aria-label="Weight" />}
              {policy === 'geolocation' && (
                <select value={r.location ?? '*'} onChange={(e) => patchRec(i, { location: e.target.value })} aria-label="Location">
                  {LOCATIONS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              )}
              {policy === 'geoproximity' && <input type="number" min={-99} max={99} style={{ width: 60 }} defaultValue={r.bias ?? 0} key={`b${r.bias}`} onBlur={(e) => patchRec(i, { bias: Number(e.target.value) })} aria-label="Bias" />}
              <label className="hint" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={r.healthCheck} onChange={(e) => patchRec(i, { healthCheck: e.target.checked })} /> health check
              </label>
              <button className="btn ghost small" onClick={() => setRecords(records.filter((_, j) => j !== i))} aria-label="Remove record">
                ✕
              </button>
            </div>
          ))}
          <button className="btn small" onClick={() => setRecords([...records, { id: `rec-${c.id}-${Date.now().toString(36)}`, targetId: null, healthCheck: true, ...(policy === 'failover' ? { failover: records.length ? 'secondary' : 'primary' } : {}) }])}>
            + Record
          </button>
          <p className="hint">A record without a health check (or Evaluate Target Health on the alias) is returned even when its target is down.</p>
        </div>
      )}
      <Toggle label="Alias record" value={cfg.alias !== false} onChange={(v) => update({ alias: v })} hint="Alias answers use the target's TTL (60 s for load balancers)." />
      {cfg.alias === false && <NumberField label="TTL" value={cfg.ttlSec ?? 300} min={0} max={172800} suffix="s" onChange={(v) => update({ ttlSec: v })} />}
      <SelectField
        label="Health check interval"
        value={String(cfg.healthCheck?.intervalSec ?? 30) as '10' | '30'}
        options={[
          { value: '30', label: 'Standard (30 s)' },
          { value: '10', label: 'Fast (10 s)' },
        ]}
        onChange={(v) => update({ healthCheck: { intervalSec: Number(v), failureThreshold: cfg.healthCheck?.failureThreshold ?? 3 } })}
      />
      <NumberField label="Failure threshold" value={cfg.healthCheck?.failureThreshold ?? 3} min={1} max={10} onChange={(v) => update({ healthCheck: { intervalSec: cfg.healthCheck?.intervalSec ?? 30, failureThreshold: v } })} />
    </>
  );
}

/** Stage 3 fields shown under the existing panels of RDS, S3, Lambda, DynamoDB and Route 53. */
export function Stage3Extras({ c }: { c: Component }) {
  const update = useUpdate(c);
  const board = useGame((s) => s.board());
  const cfg = c.config;
  switch (cfg.type) {
    case 'rds':
      return <RefSelect label="Read replica of" value={cfg.replicaOf ?? null} types={['rds']} exclude={c.id} onChange={(v) => update({ replicaOf: v })} hint="Cross-Region when the source lives in another Region. Promote it in a disaster." />;
    case 'lambda': {
      const src = cfg.eventSourceId ? board.components[cfg.eventSourceId] : undefined;
      return src?.type === 'kinesis' ? <Toggle label="Enhanced fan-out consumer" value={!!cfg.enhancedFanOut} onChange={(v) => update({ enhancedFanOut: v })} hint="Dedicated 2 MB/s per shard, pushed (~70 ms)." /> : null;
    }
    case 'dynamodb': {
      const home = regionOf(board, c);
      return (
        <>
          <Checks
            title="Global table replicas"
            items={board.regions.filter((r) => r.id !== home).map((r) => ({ id: r.id, label: `${r.id} · ${r.name}` }))}
            selected={cfg.replicaRegions ?? []}
            onChange={(ids) => update({ replicaRegions: ids })}
            hint="Every replica accepts reads and writes; replication typically within a second."
          />
          <Toggle label="DAX cluster in front of the table" value={!!cfg.dax} onChange={(v) => update({ dax: v })} hint="In-memory cache, microsecond reads (3 × dax.t3.medium per Region, approx.)." />
        </>
      );
    }
    case 'route53':
      return <Route53Fields c={c} cfg={cfg} update={update} />;
    case 's3': {
      const lock = cfg.objectLock?.mode ?? 'none';
      return (
        <>
          <SelectField label="Storage class (new objects)" value={cfg.storageClass ?? 'STANDARD'} options={classOptions} onChange={(v) => update({ storageClass: v })} />
          <LifecycleEditor cfg={cfg} update={update} />
          <div className="section" style={{ marginTop: 10 }}>
            <h4>Data protection</h4>
            <SelectField
              label="Object Lock"
              value={lock}
              options={[
                { value: 'none', label: 'Off' },
                { value: 'governance', label: 'Governance mode' },
                { value: 'compliance', label: 'Compliance mode (WORM)' },
              ]}
              onChange={(v) => update({ objectLock: v === 'none' ? undefined : { mode: v, retentionDays: cfg.objectLock?.retentionDays ?? 365 } })}
              hint="Requires versioning."
            />
            {lock !== 'none' && <NumberField label="Default retention" value={cfg.objectLock!.retentionDays} min={1} max={36500} suffix="days" onChange={(v) => update({ objectLock: { mode: lock, retentionDays: v } })} />}
            <Toggle label="MFA Delete" value={!!cfg.mfaDelete} onChange={(v) => update({ mfaDelete: v })} hint="Root user's MFA needed to delete versions." />
          </div>
          <div className="section" style={{ marginTop: 10 }}>
            <h4>Replication</h4>
            <RefSelect label="Destination bucket" value={cfg.replication?.destId ?? null} types={['s3']} exclude={c.id} onChange={(v) => update({ replication: v ? { destId: v, replicateDeletes: cfg.replication?.replicateDeletes ?? false } : undefined })} hint="Another Region = CRR, same Region = SRR. Versioning on both." />
            {cfg.replication?.destId && <Toggle label="Replicate delete markers" value={cfg.replication.replicateDeletes} onChange={(v) => update({ replication: { ...cfg.replication!, replicateDeletes: v } })} />}
          </div>
        </>
      );
    }
    default:
      return null;
  }
}

function TgwPanel({ c, cfg }: { c: Component; cfg: ConfigOf<'tgw'> }) {
  const update = useUpdate(c);
  const board = useGame((s) => s.board());
  const region = regionOf(board, c);
  const vpcs = allVpcs(board).filter((v) => board.regions.find((r) => r.id === region)?.vpcs.some((x) => x.id === v.id));
  const attachments = tgwAttachments(board, c);
  const label = (a: string) => {
    const v = allVpcs(board).find((x) => x.id === a);
    return v ? `VPC ${v.name ?? v.id} (${v.cidr})` : (board.components[a]?.name ?? a);
  };
  const setRts = (next: TgwRouteTable[]) => update({ routeTables: next });
  const patch = (i: number, p: Partial<TgwRouteTable>) => setRts(cfg.routeTables.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <>
      <Checks title="VPC attachments" items={vpcs.map((v) => ({ id: v.id, label: `${v.name ?? v.id} · ${v.cidr}` }))} selected={cfg.vpcAttachments} onChange={(ids) => update({ vpcAttachments: ids })} hint="VPN and Direct Connect attach from their own panels." />
      <Toggle label="Shared through AWS RAM" value={cfg.ramShared} onChange={(v) => update({ ramShared: v })} hint="Needed before VPCs in other accounts can attach." />
      {cfg.routeTables.map((rt, i) => (
        <div key={rt.id} className="section" style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <TextField label="Route table" value={rt.name} onChange={(v) => patch(i, { name: v })} />
            <button className="btn ghost small" onClick={() => setRts(cfg.routeTables.filter((_, j) => j !== i))} aria-label={`Delete route table ${rt.name}`}>
              ✕
            </button>
          </div>
          <table className="mini-table">
            <thead>
              <tr>
                <th>Attachment</th>
                <th title="Its traffic is looked up in this table (one table per attachment)">Assoc.</th>
                <th title="Its CIDR is propagated into this table">Prop.</th>
              </tr>
            </thead>
            <tbody>
              {attachments.map((a) => (
                <tr key={a}>
                  <td>{label(a)}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={rt.associations.includes(a)}
                      onChange={(e) =>
                        setRts(cfg.routeTables.map((r, j) => ({ ...r, associations: j === i ? (e.target.checked ? [...r.associations, a] : r.associations.filter((x) => x !== a)) : e.target.checked ? r.associations.filter((x) => x !== a) : r.associations })))
                      }
                      aria-label={`Associate ${label(a)} with ${rt.name}`}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={rt.propagations.includes(a)} onChange={(e) => patch(i, { propagations: e.target.checked ? [...rt.propagations, a] : rt.propagations.filter((x) => x !== a) })} aria-label={`Propagate ${label(a)} into ${rt.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rt.routes.map((r, k) => (
            <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              <input type="text" style={{ width: 120 }} defaultValue={r.dest} key={r.dest} onBlur={(e) => patch(i, { routes: rt.routes.map((x, j) => (j === k ? { ...x, dest: e.target.value } : x)) })} aria-label="Static route destination" />
              <span className="hint">→</span>
              <select value={r.attachment} onChange={(e) => patch(i, { routes: rt.routes.map((x, j) => (j === k ? { ...x, attachment: e.target.value } : x)) })} aria-label="Static route attachment">
                <option value="blackhole">blackhole</option>
                {attachments.map((a) => (
                  <option key={a} value={a}>
                    {label(a)}
                  </option>
                ))}
              </select>
              <button className="btn ghost small" onClick={() => patch(i, { routes: rt.routes.filter((_, j) => j !== k) })} aria-label="Remove static route">
                ✕
              </button>
            </div>
          ))}
          <button className="btn small" style={{ marginTop: 4 }} onClick={() => patch(i, { routes: [...rt.routes, { dest: '10.0.0.0/8', attachment: 'blackhole' }] })}>
            + Static route
          </button>
        </div>
      ))}
      <button className="btn small" style={{ marginTop: 8 }} onClick={() => setRts([...cfg.routeTables, { id: `tgw-rtb-${Date.now().toString(36)}`, name: `rt-${cfg.routeTables.length + 1}`, associations: [], propagations: [], routes: [] }])}>
        + TGW route table
      </button>
      <p className="hint">Point VPC route tables at the transit gateway too: both directions need a route.</p>
    </>
  );
}

/** Panels for the services Stage 3 adds. */
export function Stage3Config({ c }: { c: Component }) {
  const update = useUpdate(c);
  const board = useGame((s) => s.board());
  const cfg = c.config;
  const regions = board.regions.map((r) => ({ value: r.id, label: `${r.id} · ${r.name}` }));
  switch (cfg.type) {
    case 'aurora':
      return (
        <>
          <SelectField label="Engine" value={cfg.engine} options={[{ value: 'aurora-mysql', label: 'Aurora MySQL (3306)' }, { value: 'aurora-postgresql', label: 'Aurora PostgreSQL (5432)' }]} onChange={(v) => update({ engine: v, port: v === 'aurora-mysql' ? 3306 : 5432 })} />
          <Toggle label="Serverless v2" value={cfg.serverlessV2} onChange={(v) => update({ serverlessV2: v })} />
          {cfg.serverlessV2 ? (
            <>
              <NumberField label="Minimum capacity" value={cfg.minAcu} min={0} max={256} step={0.5} suffix="ACU" onChange={(v) => update({ minAcu: v })} />
              <NumberField label="Maximum capacity" value={cfg.maxAcu} min={1} max={256} step={0.5} suffix="ACU" onChange={(v) => update({ maxAcu: v })} />
            </>
          ) : (
            <SelectField label="Instance class" value={cfg.instanceClass} options={(['db.r6g.large', 'db.r6g.xlarge', 'db.r6g.2xlarge'] as const).map((t) => ({ value: t, label: t }))} onChange={(v) => update({ instanceClass: v })} />
          )}
          <NumberField label="Aurora Replicas" value={cfg.readers} min={0} max={15} onChange={(v) => update({ readers: v })} hint="Same Region. Failover to a replica ≈ 30 s." />
          <NumberField label="Backup retention" value={cfg.backupRetentionDays} min={1} max={35} suffix="days" onChange={(v) => update({ backupRetentionDays: v })} />
          <Toggle label="Storage encrypted" value={cfg.storageEncrypted} onChange={(v) => update({ storageEncrypted: v })} />
          <Toggle label="Publicly accessible" value={cfg.publiclyAccessible} onChange={(v) => update({ publiclyAccessible: v })} />
          <RefSelect label="Global Database secondary of" value={cfg.globalPrimaryId} types={['aurora']} exclude={c.id} onChange={(v) => update({ globalPrimaryId: v })} hint="Primary cluster in another Region. Lag < 1 s, promotion ≈ 1 min." />
        </>
      );
    case 'pcx': {
      const own = vpcOfComponent(board, c);
      const vpcs = allVpcs(board).filter((v) => v.id !== own?.id);
      return (
        <>
          <SelectField label="Accepter VPC" value={cfg.peerVpcId ?? ''} options={[{ value: '', label: '— none —' }, ...vpcs.map((v) => ({ value: v.id, label: `${v.name ?? v.id} · ${v.cidr}` }))]} onChange={(v) => update({ peerVpcId: v || null })} />
          <p className="hint">Add a route to the other VPC's CIDR via {c.name} in both VPCs. Peering is not transitive and never shares gateways.</p>
        </>
      );
    }
    case 'tgw':
      return <TgwPanel c={c} cfg={cfg} />;
    case 'vgw':
      return <p className="hint">One virtual private gateway per VPC. Attach VPN or Direct Connect connections to it, and route the on-premises CIDR to it.</p>;
    case 'cgw':
      return <NumberField label="BGP ASN" value={cfg.bgpAsn} min={1} max={4294967295} onChange={(v) => update({ bgpAsn: v })} hint="Your on-premises router." />;
    case 'vpn':
      return (
        <>
          <RefSelect label="Customer gateway" value={cfg.cgwId} types={['cgw']} onChange={(v) => update({ cgwId: v })} />
          <RefSelect label="Attach to" value={cfg.attachTo} types={['vgw', 'tgw']} onChange={(v) => update({ attachTo: v })} hint="A virtual private gateway (one VPC) or a transit gateway (many)." />
          <p className="hint">Two IPsec tunnels over the internet, up to 1.25 Gbps each. Ready in minutes.</p>
        </>
      );
    case 'dx':
      return (
        <>
          <SelectField label="Port speed" value={String(cfg.speedGbps) as '1' | '10' | '100'} options={[{ value: '1', label: '1 Gbps' }, { value: '10', label: '10 Gbps' }, { value: '100', label: '100 Gbps' }]} onChange={(v) => update({ speedGbps: Number(v) })} />
          <RefSelect label="Attach to" value={cfg.attachTo} types={['vgw', 'tgw']} onChange={(v) => update({ attachTo: v })} />
          <SelectField label="Encryption" value={cfg.encryption} options={[{ value: 'none', label: 'None (default)' }, { value: 'ipsec-vpn', label: 'IPsec VPN over DX' }, { value: 'macsec', label: 'MACsec (10/100 Gbps)' }]} onChange={(v) => update({ encryption: v })} />
          <p className="hint">Dedicated and consistent, but new connections take weeks to provision.</p>
        </>
      );
    case 'backup': {
      const protectable = Object.values(board.components).filter((x) => ['rds', 'aurora', 'dynamodb', 's3', 'ec2'].includes(x.type));
      return (
        <>
          <Checks title="Resources" items={protectable.map((x) => ({ id: x.id, label: x.name }))} selected={cfg.resourceIds} onChange={(ids) => update({ resourceIds: ids })} />
          <NumberField label="Frequency" value={cfg.frequencyHours} min={1} max={720} suffix="hours" onChange={(v) => update({ frequencyHours: v })} hint="RPO = the time between recovery points." />
          <NumberField label="Retention" value={cfg.retentionDays} min={1} max={36500} suffix="days" onChange={(v) => update({ retentionDays: v })} />
          <SelectField label="Copy to Region" value={cfg.copyRegion ?? ''} options={[{ value: '', label: '— no copy —' }, ...regions]} onChange={(v) => update({ copyRegion: v || null })} />
          <Toggle label="Copy vault in a separate account" value={cfg.copyToOtherAccount} onChange={(v) => update({ copyToOtherAccount: v })} />
          <SelectField label="Vault Lock" value={cfg.vaultLock} options={[{ value: 'none', label: 'Off' }, { value: 'governance', label: 'Governance mode' }, { value: 'compliance', label: 'Compliance mode (immutable)' }]} onChange={(v) => update({ vaultLock: v })} />
        </>
      );
    }
    case 'kinesis':
      return (
        <>
          <SelectField label="Capacity mode" value={cfg.mode} options={[{ value: 'provisioned', label: 'Provisioned' }, { value: 'onDemand', label: 'On-demand' }]} onChange={(v) => update({ mode: v })} />
          {cfg.mode === 'provisioned' && <NumberField label="Shards" value={cfg.shards} min={1} max={500} onChange={(v) => update({ shards: v })} hint="Each: 1 MB/s or 1,000 records/s in, 2 MB/s out (shared)." />}
          <NumberField label="Retention" value={cfg.retentionHours} min={24} max={8760} suffix="hours" onChange={(v) => update({ retentionHours: v })} />
        </>
      );
    case 'firehose':
      return (
        <>
          <RefSelect label="Source stream" value={cfg.sourceId} types={['kinesis']} onChange={(v) => update({ sourceId: v })} hint="None = Direct PUT from producers." />
          <RefSelect label="Destination bucket" value={cfg.destId} types={['s3']} onChange={(v) => update({ destId: v })} />
          <NumberField label="Buffer interval" value={cfg.bufferSec} min={0} max={900} suffix="s" onChange={(v) => update({ bufferSec: v })} />
          <NumberField label="Buffer size" value={cfg.bufferMb} min={1} max={128} suffix="MiB" onChange={(v) => update({ bufferMb: v })} />
          <SelectField label="Output format" value={cfg.format} options={[{ value: 'json', label: 'JSON (as received)' }, { value: 'parquet', label: 'Apache Parquet (needs ≥ 64 MiB buffer)' }]} onChange={(v) => update({ format: v })} />
        </>
      );
    case 'athena':
      return <RefSelect label="Data in bucket" value={cfg.sourceId} types={['s3']} onChange={(v) => update({ sourceId: v })} hint="Tables live in the Glue Data Catalog. Billed per TB scanned." />;
    case 'snow':
      return (
        <>
          <NumberField label="Devices" value={cfg.devices} min={1} max={20} onChange={(v) => update({ devices: v })} hint="Snowball Edge Storage Optimized, ~80 TB each in this model." />
          <RefSelect label="Import into bucket" value={cfg.destId} types={['s3']} onChange={(v) => update({ destId: v })} />
        </>
      );
    case 'datasync':
      return (
        <>
          <RefSelect label="Destination" value={cfg.destId} types={['s3']} onChange={(v) => update({ destId: v })} />
          <SelectField label="Schedule" value={cfg.schedule} options={[{ value: 'once', label: 'Run once' }, { value: 'hourly', label: 'Hourly' }, { value: 'daily', label: 'Daily' }]} onChange={(v) => update({ schedule: v })} hint="Each run copies only what changed." />
        </>
      );
    case 'dms':
      return (
        <>
          <RefSelect label="Target database" value={cfg.targetId} types={['rds', 'aurora']} onChange={(v) => update({ targetId: v })} />
          <SelectField label="Migration type" value={cfg.mode} options={[{ value: 'full-load', label: 'Migrate existing data (full load)' }, { value: 'full-load-and-cdc', label: 'Full load + ongoing replication (CDC)' }]} onChange={(v) => update({ mode: v })} />
          <p className="hint">The replication instance reaches the source over a VPN or Direct Connect.</p>
        </>
      );
    default:
      return null;
  }
}
