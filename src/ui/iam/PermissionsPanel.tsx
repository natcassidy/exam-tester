import { useState } from 'react';
import type { Component, ConfigOf } from '../../engine/model';
import type { PolicyDocument } from '../../engine/iam/types';
import { bucketPolicyDoc, iamOf, keyArn, principalArnOf } from '../../engine/iam/access';
import * as iamOps from '../../engine/iam/ops';
import { doc } from '../../engine/iam/policy';
import { updateConfig } from '../../engine/board';
import { useGame } from '../../store/game';
import { PolicyEditor } from './PolicyEditor';

const TRUST: Record<string, PolicyDocument> = {
  ec2: doc({ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }),
  lambda: doc({ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }),
};

const EMPTY_POLICY = doc({ Sid: 'Example', Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::example-bucket/*' });

/** Overview of the account's IAM: roles, users, KMS keys, SCPs. */
export function IamOverview() {
  const board = useGame((s) => s.board());
  const select = useGame((s) => s.select);
  const apply = useGame((s) => s.apply);
  const iam = iamOf(board);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'ec2' | 'lambda' | 'user'>('ec2');
  const roles = Object.values(iam.roles);
  const usedBy = (id: string) => Object.values(board.components).filter((c) => c.roleId === id);
  const create = () => {
    let newId: string | undefined;
    const ok = apply((b) => {
      const r = iamOps.createRole(b, { name: name.trim(), kind: kind === 'user' ? 'user' : 'role', policies: [], trust: kind === 'user' ? undefined : TRUST[kind] });
      if (r.ok) newId = r.id;
      return r;
    }, `${kind === 'user' ? 'User' : 'Role'} ${name.trim()} created.`);
    if (ok && newId) {
      setName('');
      select({ kind: 'role', id: newId });
    }
  };
  return (
    <>
      <p className="hint">
        Account <span className="mono">{iam.accountId}</span>
        {iam.orgId ? (
          <>
            {' '}· member of organization <span className="mono">{iam.orgId}</span>
          </>
        ) : (
          ' · standalone account (no SCPs)'
        )}
      </p>
      <div className="section">
        <h4>Roles and users</h4>
        {roles.length === 0 && <p className="hint">No roles yet. Code on EC2 or Lambda needs a role before it can call any AWS API.</p>}
        {roles.map((r) => (
          <button key={r.id} className="iam-row" onClick={() => select({ kind: 'role', id: r.id })}>
            <span className={`tag ${r.kind === 'user' ? 'warn' : 'muted'}`}>{r.kind === 'user' ? 'user' : 'role'}</span>
            <span className="nm">{r.name}</span>
            <span className="hint">
              {r.policies.length} polic{r.policies.length === 1 ? 'y' : 'ies'}
              {r.boundary ? ' · boundary' : ''}
              {usedBy(r.id).length ? ` · used by ${usedBy(r.id).map((c) => c.name).join(', ')}` : ''}
            </span>
          </button>
        ))}
        <div className="rule-form">
          <input type="text" placeholder="new-role-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Role name" style={{ flex: 1, minWidth: 120 }} />
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Kind">
            <option value="ec2">Role for EC2</option>
            <option value="lambda">Role for Lambda</option>
            <option value="user">IAM user (a person)</option>
          </select>
          <button className="btn small" disabled={!name.trim()} onClick={create}>
            Create
          </button>
        </div>
      </div>
      <div className="section">
        <h4>KMS keys</h4>
        {Object.values(iam.keys).length === 0 && <p className="hint">No customer managed keys. Buckets using SSE-KMS without one use the AWS managed key aws/s3.</p>}
        {Object.values(iam.keys).map((k) => (
          <button key={k.id} className="iam-row" onClick={() => select({ kind: 'key', id: k.id })}>
            <span className="tag muted">key</span>
            <span className="nm">{k.alias}</span>
            <span className="hint mono">{k.id.slice(0, 8)}…</span>
          </button>
        ))}
      </div>
      {iam.orgId && (
        <div className="section">
          <h4>Service control policies</h4>
          <button className="iam-row" onClick={() => select({ kind: 'scp' })}>
            <span className="tag muted">SCP</span>
            <span className="nm">{iam.scps.length} attached to this account</span>
          </button>
        </div>
      )}
    </>
  );
}

export function RoleView({ id }: { id: string }) {
  const board = useGame((s) => s.board());
  const apply = useGame((s) => s.apply);
  const select = useGame((s) => s.select);
  const r = iamOf(board).roles[id];
  const [newName, setNewName] = useState('');
  if (!r) return <p className="hint">This role no longer exists.</p>;
  const usedBy = Object.values(board.components).filter((c) => c.roleId === id);
  return (
    <>
      <p className="hint mono" style={{ wordBreak: 'break-all' }}>
        {principalArnOf(board, r)}
      </p>
      {r.description && <p className="hint">{r.description}</p>}
      {r.kind === 'role' && (
        <p className="hint">
          {usedBy.length ? (
            <>
              Attached to{' '}
              {usedBy.map((c) => (
                <button key={c.id} className="btn ghost small" onClick={() => select({ kind: 'component', id: c.id }, 'permissions')}>
                  {c.name}
                </button>
              ))}
            </>
          ) : (
            'Not attached to any component.'
          )}
        </p>
      )}
      <div className="section">
        <h4>Permission policies (identity-based)</h4>
        {r.policies.length === 0 && <p className="hint">No policies: everything is implicitly denied.</p>}
        {r.policies.map((p) => (
          <details key={p.name} className="policy-block" open={r.policies.length <= 2}>
            <summary className="mono">{p.name}</summary>
            <PolicyEditor doc={p.doc} kind="identity" allowRemove onSave={(d) => apply((b) => iamOps.setRolePolicy(b, id, p.name, d), d ? `${p.name} saved.` : `${p.name} removed.`)} />
          </details>
        ))}
        <div className="rule-form">
          <input type="text" placeholder="inline-policy-name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Policy name" style={{ flex: 1, minWidth: 120 }} />
          <button
            className="btn small"
            disabled={!newName.trim() || r.policies.some((p) => p.name === newName.trim())}
            onClick={() => apply((b) => iamOps.setRolePolicy(b, id, newName.trim(), EMPTY_POLICY), 'Policy added: edit and save it below.') && setNewName('')}
          >
            + Add policy
          </button>
        </div>
      </div>
      <div className="section">
        <h4>Permissions boundary</h4>
        <p className="hint">The maximum this {r.kind} can ever be allowed. It grants nothing by itself.</p>
        {r.boundary ? (
          <PolicyEditor doc={r.boundary} kind="boundary" allowRemove onSave={(d) => apply((b) => iamOps.setBoundary(b, id, d), d ? 'Boundary saved.' : 'Boundary removed.')} />
        ) : (
          <button className="btn small" onClick={() => apply((b) => iamOps.setBoundary(b, id, doc({ Effect: 'Allow', Action: '*', Resource: '*' })), 'Boundary added (allows everything until you narrow it).')}>
            + Set a boundary
          </button>
        )}
      </div>
      {r.kind === 'role' && (
        <div className="section">
          <h4>Trust policy</h4>
          <p className="hint">Who may assume this role (sts:AssumeRole).</p>
          <PolicyEditor doc={r.trust} kind="trust" onSave={(d) => !!d && apply((b) => iamOps.setTrustPolicy(b, id, d), 'Trust policy saved.')} />
        </div>
      )}
    </>
  );
}

export function KeyView({ id }: { id: string }) {
  const board = useGame((s) => s.board());
  const apply = useGame((s) => s.apply);
  const select = useGame((s) => s.select);
  const k = iamOf(board).keys[id];
  if (!k) return <p className="hint">This key no longer exists.</p>;
  const buckets = Object.values(board.components).filter((c) => c.config.type === 's3' && c.config.encryption === 'SSE-KMS' && c.config.kmsKeyId === id);
  return (
    <>
      <p className="hint mono" style={{ wordBreak: 'break-all' }}>
        {keyArn(board, id)}
      </p>
      <p className="hint">
        {buckets.length ? (
          <>
            Encrypts{' '}
            {buckets.map((c) => (
              <button key={c.id} className="btn ghost small" onClick={() => select({ kind: 'component', id: c.id })}>
                {c.name}
              </button>
            ))}
          </>
        ) : (
          'No bucket uses this key yet.'
        )}
      </p>
      <div className="section">
        <h4>Key policy</h4>
        <p className="hint">Every KMS key has exactly one key policy and it must allow access: IAM policies only count if the key policy delegates to the account.</p>
        <PolicyEditor doc={k.policy} kind="resource" onSave={(d) => !!d && apply((b) => iamOps.setKeyPolicy(b, id, d), 'Key policy saved.')} />
      </div>
    </>
  );
}

export function ScpView() {
  const board = useGame((s) => s.board());
  const iam = iamOf(board);
  return (
    <>
      <p className="hint">SCPs are set in the organization's management account. They never grant anything; they cap what any principal in this account can do, including the root user. Read-only here.</p>
      {iam.scps.map((p) => (
        <details key={p.name} className="policy-block" open>
          <summary className="mono">{p.name}</summary>
          <PolicyEditor doc={p.doc} kind="scp" readOnly />
        </details>
      ))}
    </>
  );
}

/** Console tab for a component: its role (compute) or its resource policy (S3, SQS, endpoints). */
export function ComponentPermissions({ c }: { c: Component }) {
  const board = useGame((s) => s.board());
  const apply = useGame((s) => s.apply);
  const select = useGame((s) => s.select);
  const iam = iamOf(board);
  const runsCode = (iamOps.ROLE_TYPES as readonly string[]).includes(c.type);
  const cfg = c.config;
  return (
    <>
      {runsCode && (
        <div className="section">
          <h4>{c.type === 'lambda' ? 'Execution role' : 'Instance profile (role)'}</h4>
          <label className="field">
            <span>Role</span>
            <select value={c.roleId ?? ''} onChange={(e) => apply((b) => iamOps.attachRole(b, c.id, e.target.value || null), e.target.value ? 'Role attached.' : 'Role detached.')}>
              <option value="">— none —</option>
              {Object.values(iam.roles)
                .filter((r) => r.kind === 'role')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          {c.roleId && iam.roles[c.roleId] && (
            <button className="btn small" onClick={() => select({ kind: 'role', id: c.roleId! })}>
              Open role {iam.roles[c.roleId].name} →
            </button>
          )}
          <p className="hint">The code gets temporary credentials for this role automatically. Never put access keys on a server.</p>
        </div>
      )}
      {cfg.type === 's3' && (
        <>
          {cfg.encryption === 'SSE-KMS' && (
            <label className="field">
              <span>
                KMS key
                <div className="hint">Readers need kms:Decrypt on it; writers kms:GenerateDataKey.</div>
              </span>
              <select value={cfg.kmsKeyId ?? ''} onChange={(e) => apply((b) => updateConfig(b, c.id, { kmsKeyId: e.target.value || null } as Partial<ConfigOf<'s3'>>))}>
                <option value="">aws/s3 (AWS managed key)</option>
                {Object.values(iam.keys).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.alias}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="section">
            <h4>Bucket policy</h4>
            {cfg.policy !== 'custom' && cfg.policy !== 'none' && <p className="hint">Rendered from the preset on the Config tab. Saving an edit turns it into a custom policy.</p>}
            <PolicyEditor doc={bucketPolicyDoc(board, c)} kind="resource" allowRemove onSave={(d) => apply((b) => iamOps.setResourcePolicy(b, c.id, d), d ? 'Bucket policy saved.' : 'Bucket policy removed.')} />
          </div>
        </>
      )}
      {(cfg.type === 'sqs' || cfg.type === 'vpce') && (
        <div className="section">
          <h4>{cfg.type === 'sqs' ? 'Queue policy' : 'Endpoint policy'}</h4>
          <p className="hint">{cfg.type === 'vpce' ? 'No policy means full access through the endpoint. A policy here filters every request that uses it, on top of IAM and bucket policies.' : 'Needed when another account or a service (SNS, S3 events) sends to the queue.'}</p>
          <PolicyEditor doc={cfg.policyDoc} kind={cfg.type === 'vpce' ? 'endpoint' : 'resource'} allowRemove onSave={(d) => apply((b) => iamOps.setResourcePolicy(b, c.id, d), d ? 'Policy saved.' : 'Policy removed.')} />
          {!cfg.policyDoc && (
            <button className="btn small" onClick={() => apply((b) => iamOps.setResourcePolicy(b, c.id, doc({ Effect: 'Allow', Principal: '*', Action: '*', Resource: '*' })), 'Policy added.')}>
              + Start from full access
            </button>
          )}
        </div>
      )}
      {!runsCode && !['s3', 'sqs', 'vpce'].includes(c.type) && <p className="hint">{c.name} has no role or resource policy in this game.</p>}
    </>
  );
}

export const hasPermissionsTab = (c: Component) => (iamOps.ROLE_TYPES as readonly string[]).includes(c.type) || ['s3', 'sqs', 'vpce'].includes(c.type);
