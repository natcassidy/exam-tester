import { describe, expect, it } from 'vitest';
import { evaluate, EvalPrincipal, EvalRequest } from '../../src/engine/iam/evaluate';
import { doc, parsePolicy } from '../../src/engine/iam/policy';
import { actionMatches, arnMatches } from '../../src/engine/iam/match';
import { evalCondition } from '../../src/engine/iam/conditions';
import { checkCall } from '../../src/engine/iam/access';
import { BoardBuilder } from '../../src/engine/builder';
import { ledgerlyLayout } from '../../src/content/missions/ledgerly';

const ACCT = '111122223333';
const OTHER = '444455556666';
const BUCKET = 'arn:aws:s3:::reports';
const OBJ = `${BUCKET}/q3.csv`;

function principal(over: Partial<EvalPrincipal> = {}): EvalPrincipal {
  return { arn: `arn:aws:iam::${ACCT}:role/app-role`, account: ACCT, holderId: 'role-app-role', identity: [], label: 'app-role', ...over };
}
function req(over: Partial<EvalRequest> = {}): EvalRequest {
  return { principal: principal(), action: 's3:GetObject', resource: OBJ, resourceAccount: ACCT, resourceLabel: 'reports', context: {}, ...over };
}
const allowGet = { name: 'read', doc: doc({ Effect: 'Allow', Action: 's3:GetObject', Resource: `${BUCKET}/*` }) };

describe('matching', () => {
  it('actions are case-insensitive with wildcards', () => {
    expect(actionMatches('s3:Get*', 's3:GetObject')).toBe(true);
    expect(actionMatches('S3:getobject', 's3:GetObject')).toBe(true);
    expect(actionMatches('s3:Put*', 's3:GetObject')).toBe(false);
    expect(actionMatches('dynamodb:?etItem', 'dynamodb:GetItem')).toBe(true);
  });
  it('ARN wildcards match within a section, not across sections', () => {
    expect(arnMatches('arn:aws:s3:::reports/*', OBJ)).toBe(true);
    expect(arnMatches('arn:aws:s3:::reports', OBJ)).toBe(false);
    expect(arnMatches('arn:aws:dynamodb:*:*:table/orders', `arn:aws:dynamodb:us-east-1:${ACCT}:table/orders`)).toBe(true);
    expect(arnMatches('arn:aws:dynamodb:us-east-1:*', `arn:aws:dynamodb:us-east-1:${ACCT}:table/orders`)).toBe(true);
    expect(arnMatches('arn:aws:sqs:*:*:orders', `arn:aws:sqs:us-east-1:${ACCT}:orders-dlq`)).toBe(false);
  });
});

describe('policy validation', () => {
  it('rejects a Principal in an identity policy and a missing Principal in a resource policy', () => {
    const p = JSON.stringify(doc({ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: '*' }));
    expect(parsePolicy(p, 'identity')).toMatchObject({ ok: false });
    expect(parsePolicy(JSON.stringify(doc({ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' })), 'resource')).toMatchObject({ ok: false });
  });
  it('rejects bad JSON, bad Effect and unknown operators', () => {
    expect(parsePolicy('{', 'identity').ok).toBe(false);
    expect(parsePolicy(JSON.stringify(doc({ Effect: 'allow' as 'Allow', Action: 's3:*', Resource: '*' })), 'identity').ok).toBe(false);
    expect(parsePolicy(JSON.stringify(doc({ Effect: 'Allow', Action: 's3:*', Resource: '*', Condition: { NumericLessThan: { 'aws:x': '1' } } })), 'identity').ok).toBe(false);
  });
  it('accepts a valid policy', () => {
    expect(parsePolicy(JSON.stringify(allowGet.doc), 'identity').ok).toBe(true);
  });
});

describe('IAM evaluation logic', () => {
  it('denies by default (implicit deny)', () => {
    const d = evaluate(req());
    expect(d.decision).toBe('deny');
    expect(d.reason).toBe('implicit-deny');
  });

  it('identity policy allow grants access', () => {
    expect(evaluate(req({ principal: principal({ identity: [allowGet] }) })).decision).toBe('allow');
  });

  it('explicit deny overrides allow', () => {
    const deny = { name: 'guard', doc: doc({ Effect: 'Deny', Action: 's3:*', Resource: '*' }) };
    const d = evaluate(req({ principal: principal({ identity: [allowGet, deny] }) }));
    expect(d.decision).toBe('deny');
    expect(d.reason).toBe('explicit-deny');
    expect(d.steps[0]).toMatchObject({ kind: 'explicit-deny', result: 'deny' });
  });

  it('a same-account resource policy naming the principal grants access on its own', () => {
    const rp = doc({ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:role/app-role` }, Action: 's3:GetObject', Resource: `${BUCKET}/*` });
    const d = evaluate(req({ resourcePolicy: { doc: rp, name: 'bucket policy', holder: 's3-1', holderKind: 'component' } }));
    expect(d.decision).toBe('allow');
    expect(d.steps.some((s) => s.kind === 'resource-policy' && s.result === 'allow')).toBe(true);
  });

  it('a resource policy that names only the account delegates to IAM', () => {
    const rp = { doc: doc({ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:root` }, Action: 's3:GetObject', Resource: `${BUCKET}/*` }), name: 'bucket policy', holder: 's3-1', holderKind: 'component' as const };
    expect(evaluate(req({ resourcePolicy: rp })).decision).toBe('deny');
    expect(evaluate(req({ resourcePolicy: rp, principal: principal({ identity: [allowGet] }) })).decision).toBe('allow');
  });

  it('cross-account access needs both the identity policy and the resource policy', () => {
    const other = principal({ arn: `arn:aws:iam::${OTHER}:role/partner`, account: OTHER });
    const rp = { doc: doc({ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${OTHER}:role/partner` }, Action: 's3:GetObject', Resource: `${BUCKET}/*` }), name: 'bucket policy', holder: 's3-1', holderKind: 'component' as const };
    expect(evaluate(req({ principal: other, resourcePolicy: rp })).decision).toBe('deny'); // resource side only
    expect(evaluate(req({ principal: { ...other, identity: [allowGet] } })).decision).toBe('deny'); // identity side only
    expect(evaluate(req({ principal: { ...other, identity: [allowGet] }, resourcePolicy: rp })).decision).toBe('allow');
  });

  it('an SCP restricts even an administrator', () => {
    const admin = principal({ identity: [{ name: 'AdministratorAccess', doc: doc({ Effect: 'Allow', Action: '*', Resource: '*' }) }] });
    const scps = [{ name: 'only-s3-read', doc: doc({ Effect: 'Allow', Action: ['s3:Get*', 's3:List*'], Resource: '*' }) }];
    expect(evaluate(req({ principal: admin, scps })).decision).toBe('allow');
    const d = evaluate(req({ principal: admin, scps, action: 's3:DeleteObject' }));
    expect(d.decision).toBe('deny');
    expect(d.steps.find((s) => s.kind === 'scp')?.result).toBe('deny');
    const denyScp = [{ name: 'FullAWSAccess', doc: doc({ Effect: 'Allow', Action: '*', Resource: '*' }) }, { name: 'no-delete', doc: doc({ Effect: 'Deny', Action: 's3:DeleteObject', Resource: '*' }) }];
    expect(evaluate(req({ principal: admin, scps: denyScp, action: 's3:DeleteObject' })).reason).toBe('explicit-deny');
  });

  it('a permissions boundary caps the identity policy', () => {
    const p = principal({ identity: [{ name: 'broad', doc: doc({ Effect: 'Allow', Action: 's3:*', Resource: '*' }) }], boundary: doc({ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }) });
    expect(evaluate(req({ principal: p })).decision).toBe('allow');
    const d = evaluate(req({ principal: p, action: 's3:PutObject' }));
    expect(d.decision).toBe('deny');
    expect(d.steps.find((s) => s.kind === 'boundary')?.result).toBe('deny');
    // The boundary alone grants nothing.
    expect(evaluate(req({ principal: principal({ boundary: doc({ Effect: 'Allow', Action: 's3:*', Resource: '*' }) }) })).decision).toBe('deny');
  });

  it('KMS: the key policy is required; IAM policies only count if it delegates to the account', () => {
    const keyArn = `arn:aws:kms:us-east-1:${ACCT}:key/k1`;
    const withKms = principal({ identity: [{ name: 'kms', doc: doc({ Effect: 'Allow', Action: 'kms:*', Resource: '*' }) }] });
    const base = { action: 'kms:Decrypt', resource: keyArn, resourceKind: 'kms' as const, resourceLabel: 'key' };
    const adminsOnly = { doc: doc({ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:role/key-admin` }, Action: 'kms:*', Resource: '*' }), name: 'key policy', holder: 'k1', holderKind: 'key' as const };
    const d = evaluate(req({ ...base, principal: withKms, resourcePolicy: adminsOnly }));
    expect(d.decision).toBe('deny');
    expect(d.steps.find((s) => s.kind === 'key-policy')?.result).toBe('deny');
    const delegating = { ...adminsOnly, doc: doc({ Sid: 'EnableIAM', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:root` }, Action: 'kms:*', Resource: '*' }) };
    expect(evaluate(req({ ...base, principal: withKms, resourcePolicy: delegating })).decision).toBe('allow');
    expect(evaluate(req({ ...base, principal: principal(), resourcePolicy: delegating })).decision).toBe('deny');
    const direct = { ...adminsOnly, doc: doc({ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:role/app-role` }, Action: ['kms:Decrypt'], Resource: '*' }) };
    expect(evaluate(req({ ...base, principal: principal(), resourcePolicy: direct })).decision).toBe('allow');
  });

  it('role assumption needs the trust policy', () => {
    const roleArn = `arn:aws:iam::${ACCT}:role/deploy`;
    const caller = principal({ identity: [{ name: 'assume', doc: doc({ Effect: 'Allow', Action: 'sts:AssumeRole', Resource: roleArn }) }] });
    const base = { action: 'sts:AssumeRole', resource: roleArn, resourceKind: 'role' as const, resourceLabel: 'deploy' };
    expect(evaluate(req({ ...base, principal: caller, resourcePolicy: null })).decision).toBe('deny');
    const trustAccount = { doc: doc({ Effect: 'Allow', Principal: { AWS: ACCT }, Action: 'sts:AssumeRole' }), name: 'trust policy', holder: 'role-deploy', holderKind: 'role' as const };
    expect(evaluate(req({ ...base, principal: caller, resourcePolicy: trustAccount })).decision).toBe('allow');
    expect(evaluate(req({ ...base, principal: principal(), resourcePolicy: trustAccount })).decision).toBe('deny');
  });
});

describe('condition keys', () => {
  it('missing keys: positive operators fail, negated operators pass, IfExists passes', () => {
    expect(evalCondition('StringEquals', 'aws:SourceVpce', 'vpce-1', {})).toBe(false);
    expect(evalCondition('StringNotEquals', 'aws:SourceVpce', 'vpce-1', {})).toBe(true);
    expect(evalCondition('StringEqualsIfExists', 'aws:SourceVpce', 'vpce-1', {})).toBe(true);
  });
  it('Bool, IpAddress, StringLike, ArnLike and case-insensitive key names', () => {
    expect(evalCondition('Bool', 'aws:SecureTransport', 'false', { 'aws:SecureTransport': false })).toBe(true);
    expect(evalCondition('Bool', 'aws:MultiFactorAuthPresent', 'true', { 'aws:MultiFactorAuthPresent': false })).toBe(false);
    expect(evalCondition('IpAddress', 'aws:SourceIp', '198.51.100.0/24', { 'aws:SourceIp': '198.51.100.7' })).toBe(true);
    expect(evalCondition('NotIpAddress', 'aws:SourceIp', '198.51.100.0/24', { 'aws:SourceIp': '203.0.113.9' })).toBe(true);
    expect(evalCondition('StringLike', 'aws:PrincipalOrgID', 'o-abc*', { 'aws:PrincipalOrgID': 'o-abc123' })).toBe(true);
    expect(evalCondition('ArnLike', 'aws:PrincipalArn', `arn:aws:iam::${ACCT}:role/ops-*`, { 'aws:PrincipalArn': `arn:aws:iam::${ACCT}:role/ops-team` })).toBe(true);
    expect(evalCondition('StringEquals', 'AWS:SourceVpce', 'vpce-1', { 'aws:sourcevpce': 'vpce-1' })).toBe(true);
  });
  it('deny unless HTTPS: aws:SecureTransport', () => {
    const p = principal({ identity: [allowGet] });
    const rp = { doc: doc({ Sid: 'TLSOnly', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [BUCKET, `${BUCKET}/*`], Condition: { Bool: { 'aws:SecureTransport': 'false' } } }), name: 'bucket policy', holder: 's3-1', holderKind: 'component' as const };
    expect(evaluate(req({ principal: p, resourcePolicy: rp, context: { 'aws:SecureTransport': true } })).decision).toBe('allow');
    expect(evaluate(req({ principal: p, resourcePolicy: rp, context: { 'aws:SecureTransport': false } })).reason).toBe('explicit-deny');
  });
  it('aws:PrincipalOrgID limits a resource policy to the organization', () => {
    const rp = { doc: doc({ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `${BUCKET}/*`, Condition: { StringEquals: { 'aws:PrincipalOrgID': 'o-acme' } } }), name: 'bucket policy', holder: 's3-1', holderKind: 'component' as const };
    const other = principal({ arn: `arn:aws:iam::${OTHER}:role/x`, account: OTHER, identity: [allowGet] });
    expect(evaluate(req({ principal: other, resourcePolicy: rp, context: { 'aws:PrincipalOrgID': 'o-acme' } })).decision).toBe('allow');
    expect(evaluate(req({ principal: other, resourcePolicy: rp, context: { 'aws:PrincipalOrgID': 'o-evil' } })).decision).toBe('deny');
  });
});

describe('board-level calls', () => {
  function board(keyPolicyAllowsApp: boolean) {
    return new BoardBuilder(ledgerlyLayout, 'helpful')
      .place('asg', 'app-a', { name: 'app-asg' })
      .place('s3', '', { name: 'reports' })
      .role({ name: 'app-role', kind: 'role', policies: [{ name: 's3', doc: doc({ Effect: 'Allow', Action: 's3:*', Resource: ['arn:aws:s3:::reports', 'arn:aws:s3:::reports/*'] }) }] })
      .attachRole('app-asg', 'app-role')
      .key('k1', 'reports-key', doc(
        { Sid: 'Admins', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:role/key-admin` }, Action: 'kms:*', Resource: '*' },
        ...(keyPolicyAllowsApp ? [{ Sid: 'App', Effect: 'Allow' as const, Principal: { AWS: `arn:aws:iam::${ACCT}:role/app-role` }, Action: ['kms:Decrypt', 'kms:GenerateDataKey'], Resource: '*' }] : []),
      ))
      .config('reports', { encryption: 'SSE-KMS', kmsKeyId: 'k1' })
      .done();
  }
  it('S3 GetObject on an SSE-KMS bucket also needs kms:Decrypt on the key', () => {
    const b = board(false);
    const id = Object.values(b.components).find((c) => c.name === 'app-asg')!.id;
    const s3 = Object.values(b.components).find((c) => c.name === 'reports')!.id;
    const r = checkCall(b, { principal: id, action: 's3:GetObject', resource: s3, objectKey: 'q3.csv' });
    expect(r.allowed).toBe(false);
    expect(r.decisions.map((d) => [d.action, d.decision])).toEqual([['s3:GetObject', 'allow'], ['kms:Decrypt', 'deny']]);
    const ok = checkCall(board(true), { principal: id, action: 's3:PutObject', resource: s3 });
    expect(ok.decisions.map((d) => d.action)).toEqual(['s3:PutObject', 'kms:GenerateDataKey']);
    expect(ok.allowed).toBe(true);
  });
  it('a component without a role makes unsigned requests', () => {
    const b = new BoardBuilder(ledgerlyLayout, 'helpful').place('asg', 'app-a', { name: 'app-asg' }).place('s3', '', { name: 'reports' }).done();
    const ids = Object.values(b.components);
    const r = checkCall(b, { principal: ids.find((c) => c.type === 'asg')!.id, action: 's3:GetObject', resource: ids.find((c) => c.type === 's3')!.id });
    expect(r.allowed).toBe(false);
    expect(r.error).toMatch(/no IAM role/);
  });
});
