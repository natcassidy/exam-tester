// Board operations for IAM objects. Pure: each returns a new board.

import type { Board } from '../model';
import type { IamPrincipalDef, KmsKey, PolicyDocument } from './types';
import { clone, OpResult } from '../board';
import { iamOf } from './access';
import { PolicyKind, validatePolicy } from './policy';

export const ROLE_TYPES = ['ec2', 'asg', 'lambda'] as const;

function withIam(board0: Board): Board {
  const board = clone(board0);
  board.iam = clone(iamOf(board0));
  return board;
}

function check(doc: PolicyDocument, kind: PolicyKind): string | null {
  const r = validatePolicy(doc, kind);
  return r.ok ? null : r.errors.join('\n');
}

export function createRole(board0: Board, role: Omit<IamPrincipalDef, 'id'> & { id?: string }): OpResult {
  if (!/^[\w+=,.@-]{1,64}$/.test(role.name)) return { ok: false, error: 'Role names may contain letters, numbers and +=,.@_- (max 64).' };
  const board = withIam(board0);
  const iam = board.iam!;
  if (Object.values(iam.roles).some((r) => r.name === role.name)) return { ok: false, error: `EntityAlreadyExists: ${role.kind === 'user' ? 'User' : 'Role'} with name ${role.name} already exists.` };
  board.seq += 1;
  const id = role.id ?? `${role.kind}-${board.seq}`;
  iam.roles[id] = { ...clone(role), id };
  return { ok: true, board, id };
}

export function setRolePolicy(board0: Board, roleId: string, name: string, doc: PolicyDocument | null): OpResult {
  const role0 = iamOf(board0).roles[roleId];
  if (!role0) return { ok: false, error: 'Unknown role.' };
  if (doc) {
    const e = check(doc, 'identity');
    if (e) return { ok: false, error: e };
  }
  const board = withIam(board0);
  const role = board.iam!.roles[roleId];
  const i = role.policies.findIndex((p) => p.name === name);
  if (!doc) role.policies = role.policies.filter((p) => p.name !== name);
  else if (i >= 0) role.policies[i] = { name, doc: clone(doc) };
  else role.policies.push({ name, doc: clone(doc) });
  return { ok: true, board };
}

export function setBoundary(board0: Board, roleId: string, doc: PolicyDocument | null): OpResult {
  if (!iamOf(board0).roles[roleId]) return { ok: false, error: 'Unknown role.' };
  if (doc) {
    const e = check(doc, 'boundary');
    if (e) return { ok: false, error: e };
  }
  const board = withIam(board0);
  board.iam!.roles[roleId].boundary = doc ? clone(doc) : null;
  return { ok: true, board };
}

export function setTrustPolicy(board0: Board, roleId: string, doc: PolicyDocument): OpResult {
  const r = iamOf(board0).roles[roleId];
  if (!r) return { ok: false, error: 'Unknown role.' };
  if (r.kind === 'user') return { ok: false, error: 'IAM users have no trust policy; only roles can be assumed.' };
  const e = check(doc, 'trust');
  if (e) return { ok: false, error: e };
  const board = withIam(board0);
  board.iam!.roles[roleId].trust = clone(doc);
  return { ok: true, board };
}

export function setKeyPolicy(board0: Board, keyId: string, doc: PolicyDocument): OpResult {
  if (!iamOf(board0).keys[keyId]) return { ok: false, error: 'Unknown KMS key.' };
  const e = check(doc, 'resource');
  if (e) return { ok: false, error: e };
  const board = withIam(board0);
  board.iam!.keys[keyId].policy = clone(doc);
  return { ok: true, board };
}

export function createKey(board0: Board, key: KmsKey): OpResult {
  const e = check(key.policy, 'resource');
  if (e) return { ok: false, error: e };
  const board = withIam(board0);
  board.iam!.keys[key.id] = clone(key);
  return { ok: true, board, id: key.id };
}

export function attachRole(board0: Board, componentId: string, roleId: string | null): OpResult {
  const c = board0.components[componentId];
  if (!c) return { ok: false, error: 'Unknown component.' };
  if (!(ROLE_TYPES as readonly string[]).includes(c.type)) return { ok: false, error: `${c.name} doesn't run code, so it has no role. Resource access is controlled by its resource policy.` };
  const role = roleId ? iamOf(board0).roles[roleId] : null;
  if (roleId && !role) return { ok: false, error: 'Unknown role.' };
  if (role?.kind === 'user') return { ok: false, error: 'An instance profile or execution role must contain an IAM role, not a user. Never put access keys on servers.' };
  const board = withIam(board0);
  if (roleId) board.components[componentId].roleId = roleId;
  else delete board.components[componentId].roleId;
  return { ok: true, board };
}

/** Resource policies held by components: S3 bucket policy, SQS queue policy, gateway endpoint policy. */
export function setResourcePolicy(board0: Board, componentId: string, doc: PolicyDocument | null): OpResult {
  const c = board0.components[componentId];
  if (!c) return { ok: false, error: 'Unknown component.' };
  const kind: PolicyKind = c.type === 'vpce' ? 'endpoint' : 'resource';
  if (doc) {
    const e = check(doc, kind);
    if (e) return { ok: false, error: e };
  }
  const board = clone(board0);
  const cfg = board.components[componentId].config;
  if (cfg.type === 's3') {
    if (doc && cfg.blockPublicAccess && doc.Statement.some((s) => s.Effect === 'Allow' && (s.Principal === '*' || (typeof s.Principal === 'object' && [s.Principal.AWS].flat().includes('*'))) && !s.Condition))
      return { ok: false, error: 'Access denied: Block Public Access (BlockPublicPolicy) is on, so S3 rejects a bucket policy that grants public access.' };
    cfg.policy = doc ? 'custom' : 'none';
    cfg.customPolicy = doc ? clone(doc) : null;
  } else if (cfg.type === 'sqs') cfg.policyDoc = doc ? clone(doc) : null;
  else if (cfg.type === 'vpce') cfg.policyDoc = doc ? clone(doc) : null;
  else return { ok: false, error: `${c.name} has no resource-based policy in this game.` };
  return { ok: true, board };
}
