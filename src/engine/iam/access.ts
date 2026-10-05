// Board-level permission checks: who is calling (a role, a user, or a component's role),
// what ARN they call, which resource policy applies, and the KMS call S3 makes on their behalf.

import type { Board, Component, ConfigOf, Hop, Trace } from '../model';
import type { IamDecision, IamPrincipalDef, IamState, PolicyDocument, RequestContext } from './types';
import { evaluate, EvalPrincipal, EvalRequest, HeldPolicy } from './evaluate';
import { traceFlow } from '../net/trace';

export const DEFAULT_ACCOUNT = '111122223333';
export const REGION = 'us-east-1';

export function iamOf(board: Board): IamState {
  return board.iam ?? { accountId: DEFAULT_ACCOUNT, roles: {}, keys: {}, scps: [] };
}

export function principalArnOf(board: Board, r: IamPrincipalDef): string {
  return `arn:aws:iam::${iamOf(board).accountId}:${r.kind}/${r.name}`;
}

export function keyArn(board: Board, keyId: string): string {
  return `arn:aws:kms:${REGION}:${iamOf(board).accountId}:key/${keyId}`;
}

export function resourceArnOf(board: Board, c: Component, objectKey?: string): string {
  const acct = iamOf(board).accountId;
  switch (c.type) {
    case 's3':
      return objectKey !== undefined ? `arn:aws:s3:::${c.name}/${objectKey}` : `arn:aws:s3:::${c.name}`;
    case 'dynamodb':
      return `arn:aws:dynamodb:${REGION}:${acct}:table/${c.name}`;
    case 'sqs':
      return `arn:aws:sqs:${REGION}:${acct}:${c.name}`;
    case 'lambda':
      return `arn:aws:lambda:${REGION}:${acct}:function:${c.name}`;
    case 'cloudfront':
      return `arn:aws:cloudfront::${acct}:distribution/${c.id.toUpperCase()}`;
    default:
      return `arn:aws:${c.type}:${REGION}:${acct}:${c.id}`;
  }
}

/** The bucket policy as a JSON document: presets are rendered, 'custom' is stored verbatim. */
export function bucketPolicyDoc(board: Board, c: Component): PolicyDocument | null {
  const cfg = c.config as ConfigOf<'s3'>;
  if (cfg.policy === 'custom') return cfg.customPolicy ?? null;
  if (cfg.policy === 'public-read') return { Version: '2012-10-17', Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${c.name}/*` }] };
  if (cfg.policy === 'cloudfront-oac') {
    const dist = cfg.policyDistributionId ? board.components[cfg.policyDistributionId] : null;
    return {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AllowCloudFrontServicePrincipalReadOnly',
          Effect: 'Allow',
          Principal: { Service: 'cloudfront.amazonaws.com' },
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${c.name}/*`,
          Condition: { StringEquals: { 'AWS:SourceArn': dist ? resourceArnOf(board, dist) : 'arn:aws:cloudfront::<account>:distribution/<none>' } },
        },
      ],
    };
  }
  return null;
}

function resourcePolicyOf(board: Board, c: Component): HeldPolicy | null {
  if (c.type === 's3') {
    const d = bucketPolicyDoc(board, c);
    return d ? { doc: d, name: `bucket policy of ${c.name}`, holder: c.id, holderKind: 'component' } : null;
  }
  if (c.config.type === 'sqs' && c.config.policyDoc) return { doc: c.config.policyDoc, name: `queue policy of ${c.name}`, holder: c.id, holderKind: 'component' };
  return null;
}

/** A caller: a role or user id, a component with an attached role, or "service:<principal>:<sourceComponentId>". */
export interface Caller {
  principal: EvalPrincipal | null;
  label: string;
  /** Component making the call from inside the VPC, if any (for the network leg). */
  component?: Component;
  roleId?: string;
}

export function resolveCaller(board: Board, ref: string): Caller {
  const iam = iamOf(board);
  if (ref.startsWith('service:')) {
    const svc = ref.slice('service:'.length);
    return { principal: { arn: svc, account: '', holderId: '', identity: [], service: svc, label: svc }, label: svc };
  }
  const role = iam.roles[ref] ?? Object.values(iam.roles).find((r) => r.name === ref);
  if (role) return { principal: toPrincipal(board, role, `${role.kind === 'user' ? 'IAM user' : 'role'} ${role.name}`), label: role.name, roleId: role.id };
  const c = board.components[ref];
  if (c) {
    const r = c.roleId ? iam.roles[c.roleId] : undefined;
    const how = c.type === 'lambda' ? 'execution role' : 'instance profile';
    if (!r) return { principal: null, label: c.name, component: c };
    return { principal: toPrincipal(board, r, `${r.name} (${how} of ${c.name})`), label: `${c.name} as ${r.name}`, component: c, roleId: r.id };
  }
  return { principal: null, label: ref };
}

function toPrincipal(board: Board, r: IamPrincipalDef, label: string): EvalPrincipal {
  return { arn: principalArnOf(board, r), account: iamOf(board).accountId, holderId: r.id, identity: r.policies, boundary: r.boundary ?? null, label };
}

export interface CallSpec {
  /** Role/user id or name, or a component id (uses its attached role). */
  principal: string;
  action: string;
  /** Component id (S3, SQS, DynamoDB, Lambda), KMS key id, or role id (for sts:AssumeRole). */
  resource: string;
  objectKey?: string;
  context?: RequestContext;
  /** Gateway endpoint the request travels through (sets aws:SourceVpce and applies its policy). */
  viaEndpoint?: string;
}

export interface CallResult {
  allowed: boolean;
  decisions: IamDecision[];
  /** Set when there is no principal or no resource to evaluate. */
  error?: string;
}

const KMS_FOR: Record<string, string> = { 's3:getobject': 'kms:Decrypt', 's3:putobject': 'kms:GenerateDataKey' };

export function checkCall(board: Board, spec: CallSpec): CallResult {
  const iam = iamOf(board);
  const caller = resolveCaller(board, spec.principal);
  if (!caller.principal) {
    const what = caller.component ? `${caller.component.name} has no IAM role attached, so its requests are unsigned (no instance profile / execution role). AWS rejects them.` : `Unknown principal ${spec.principal}.`;
    return { allowed: false, decisions: [], error: what };
  }
  const p = caller.principal;
  const ctx: RequestContext = {
    'aws:SecureTransport': true,
    'aws:PrincipalArn': p.service ? undefined : p.arn,
    'aws:PrincipalAccount': p.service ? undefined : p.account,
    'aws:PrincipalOrgID': p.service ? undefined : iam.orgId,
    'aws:MultiFactorAuthPresent': undefined,
  };
  let endpointPolicy: HeldPolicy | null = null;
  if (spec.viaEndpoint) {
    const ep = board.components[spec.viaEndpoint];
    ctx['aws:SourceVpce'] = spec.viaEndpoint;
    if (ep) ctx['aws:SourceVpc'] = ep.placement.refId;
    if (ep?.config.type === 'vpce' && ep.config.policyDoc) endpointPolicy = { doc: ep.config.policyDoc, name: `endpoint policy of ${ep.name}`, holder: ep.id, holderKind: 'endpoint' };
  }
  Object.assign(ctx, spec.context ?? {});

  const role = iam.roles[spec.resource];
  const key = iam.keys[spec.resource];
  const comp = board.components[spec.resource];
  let req: EvalRequest;
  if (role) {
    req = { principal: p, action: spec.action, resource: principalArnOf(board, role), resourceAccount: iam.accountId, resourceLabel: `role ${role.name}`, resourceKind: 'role', resourcePolicy: role.trust ? { doc: role.trust, name: `trust policy of ${role.name}`, holder: role.id, holderKind: 'role' } : null, scps: iam.scps, context: ctx };
  } else if (key) {
    req = { principal: p, action: spec.action, resource: keyArn(board, key.id), resourceAccount: iam.accountId, resourceLabel: `KMS key ${key.alias}`, resourceKind: 'kms', resourcePolicy: { doc: key.policy, name: `key policy of ${key.alias}`, holder: key.id, holderKind: 'key' }, scps: iam.scps, context: ctx };
  } else if (comp) {
    const objLevel = comp.type === 's3' && /^s3:(Get|Put|Delete)Object/i.test(spec.action);
    req = { principal: p, action: spec.action, resource: resourceArnOf(board, comp, objLevel ? spec.objectKey ?? 'data/object' : undefined), resourceAccount: comp.type === 's3' ? '' : iam.accountId, resourceLabel: comp.name, resourcePolicy: resourcePolicyOf(board, comp), scps: iam.scps, endpointPolicy, context: ctx };
    // S3 buckets carry no account in their ARN; they live in this account.
    req.resourceAccount = iam.accountId;
  } else return { allowed: false, decisions: [], error: `Unknown resource ${spec.resource}.` };

  const first = evaluate(req);
  const decisions = [first];
  if (first.decision === 'allow' && comp?.config.type === 's3' && comp.config.encryption === 'SSE-KMS') {
    const kmsAction = KMS_FOR[spec.action.toLowerCase()];
    if (kmsAction) {
      const cmk = comp.config.kmsKeyId ? iam.keys[comp.config.kmsKeyId] : undefined;
      if (cmk) {
        decisions.push(
          evaluate({
            principal: p,
            action: kmsAction,
            resource: keyArn(board, cmk.id),
            resourceAccount: iam.accountId,
            resourceLabel: `KMS key ${cmk.alias}`,
            resourceKind: 'kms',
            resourcePolicy: { doc: cmk.policy, name: `key policy of ${cmk.alias}`, holder: cmk.id, holderKind: 'key' },
            scps: iam.scps,
            context: { ...ctx, 'kms:ViaService': `s3.${REGION}.amazonaws.com` },
          }),
        );
      } else {
        decisions.push({
          action: kmsAction,
          resource: 'alias/aws/s3',
          principalArn: p.arn,
          decision: 'allow',
          reason: 'allowed',
          steps: [{ kind: 'key-policy', result: 'allow', explain: `${comp.name} uses the AWS managed key aws/s3. Its key policy lets any principal in the account use it through S3 (kms:ViaService), so an S3 permission is enough.` }],
        });
      }
    }
  }
  return { allowed: decisions.every((d) => d.decision === 'allow'), decisions };
}

/** Turn a decision into a trace hop. */
export function iamHop(board: Board, d: IamDecision, resourceId: string): Hop {
  const decided = d.steps.filter((s) => s.kind !== 'decision' && s.result === d.decision);
  const decisive = [...decided].reverse().find((s) => s.ref) ?? decided[decided.length - 1];
  const ref = d.decisive;
  const objectId = ref ? (ref.holderKind === 'scp' ? 'scp' : ref.holder) : resourceId;
  const at: Hop['at'] = ref?.holderKind === 'role' ? { kind: 'role', id: ref.holder } : ref?.holderKind === 'key' ? { kind: 'key', id: ref.holder } : { kind: 'component', id: board.components[objectId] ? objectId : resourceId };
  return {
    at,
    check: 'iam',
    result: d.decision,
    matched: ref ? { objectId, ruleRef: `${ref.policyName}${ref.sid ? ` · ${ref.sid}` : ref.statementIndex !== undefined ? ` · statement #${ref.statementIndex + 1}` : ''}` } : undefined,
    explain: `${d.action}: ${decisive?.explain ?? d.steps[d.steps.length - 1].explain}`,
    iam: d,
  };
}

const NETWORK_TARGET: Record<string, 'svc:s3' | 'svc:dynamodb' | 'internet'> = { s3: 'svc:s3', dynamodb: 'svc:dynamodb', sqs: 'internet', lambda: 'internet' };

/**
 * One end-to-end check: can the packet get there, and is the call allowed?
 * Callers inside the VPC are traced to the service first; the endpoint they use feeds aws:SourceVpce.
 */
export function traceCall(board: Board, spec: CallSpec): Trace {
  const caller = resolveCaller(board, spec.principal);
  const target = board.components[spec.resource];
  let hops: Hop[] = [];
  let returnHops: Hop[] = [];
  let via: Trace['via'] = 'none';
  let viaEndpoint = spec.viaEndpoint;
  if (caller.component && caller.component.placement.kind === 'subnet' && target && NETWORK_TARGET[target.type]) {
    const net = traceFlow(board, { from: caller.component.id, to: NETWORK_TARGET[target.type], protocol: 'tcp', port: 443 });
    if (net.result === 'dropped') return net;
    hops = net.hops;
    returnHops = net.returnHops;
    via = net.via;
    viaEndpoint = net.hops.find((h) => h.at.kind === 'vpce')?.at.id ?? viaEndpoint;
  } else {
    const origin = caller.component ? `${caller.component.name} runs outside your VPC and calls the public ${target?.type.toUpperCase() ?? 'AWS'} endpoint over HTTPS.` : `${caller.label} calls the public AWS endpoint over HTTPS${spec.context?.['aws:SourceIp'] ? ` from ${spec.context['aws:SourceIp']}` : ''}.`;
    hops = [{ at: { kind: caller.component ? 'component' : 'internet', id: caller.component?.id ?? 'internet' }, check: 'route', result: 'info', explain: origin }];
  }
  const r = checkCall(board, { ...spec, viaEndpoint });
  if (r.error) {
    hops.push({ at: { kind: 'component', id: caller.component?.id ?? spec.resource }, check: 'iam', result: 'deny', explain: r.error });
    return { result: 'dropped', hops, returnHops, via };
  }
  for (const d of r.decisions) hops.push(iamHop(board, d, spec.resource));
  return { result: r.allowed ? 'delivered' : 'dropped', hops, returnHops: r.allowed ? returnHops : [], via };
}
