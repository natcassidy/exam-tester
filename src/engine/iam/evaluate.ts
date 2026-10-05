// The IAM policy evaluator. Follows AWS evaluation logic, step by step, and records every step
// so the UI can show it like a packet trace:
//   1. An explicit Deny in any applicable policy wins.
//   2. If the account is in an organization, the SCPs must allow the action.
//   (VPC endpoint policy, when the call goes through an endpoint, must allow it too.)
//   3. A resource-based policy Allow: in the same account it can grant access on its own;
//      cross-account access needs both the resource policy and the identity policy.
//      KMS key policies and role trust policies are required: IAM policies only count when
//      the key/trust policy delegates to the account.
//   4. A permissions boundary, if present, must allow.
//   5. An identity-based policy Allow.
//   6. Otherwise: implicit deny.

import type { IamDecision, IamStep, NamedPolicy, PolicyDocument, PolicyRef, RequestContext, Statement } from './types';
import { actionMatches, arnMatches, list } from './match';
import { describeCondition, evalConditionBlock } from './conditions';

export interface EvalPrincipal {
  arn: string;
  account: string;
  /** Role/user id that holds the identity policies (for "Fix it"). */
  holderId: string;
  identity: NamedPolicy[];
  boundary?: PolicyDocument | null;
  /** Set for AWS service principals such as cloudfront.amazonaws.com. */
  service?: string;
  /** Human label, e.g. "app-role (instance profile of app-asg)". */
  label: string;
}

export interface HeldPolicy {
  doc: PolicyDocument;
  name: string;
  holder: string;
  holderKind: PolicyRef['holderKind'];
}

export interface EvalRequest {
  principal: EvalPrincipal;
  action: string;
  resource: string;
  resourceAccount: string;
  resourceLabel: string;
  resourcePolicy?: HeldPolicy | null;
  /** 'kms' and 'role': the resource policy is mandatory (key policy / trust policy). */
  resourceKind?: 'generic' | 'kms' | 'role';
  /** SCPs that apply to the principal's account (empty or undefined = not in an organization). */
  scps?: NamedPolicy[];
  endpointPolicy?: HeldPolicy | null;
  context: RequestContext;
}

type Use = 'identity' | 'resource';

interface Match {
  statement: Statement;
  index: number;
  /** Resource-policy match only through the account principal (delegation to IAM). */
  viaAccount?: boolean;
}

function principalMatch(s: Statement, p: EvalPrincipal): { ok: boolean; viaAccount: boolean } {
  const pr = s.Principal;
  if (pr === undefined) return { ok: false, viaAccount: false };
  if (pr === '*') return { ok: true, viaAccount: false };
  for (const svc of list(pr.Service)) if (p.service && svc === p.service) return { ok: true, viaAccount: false };
  if (p.service) return { ok: false, viaAccount: false };
  for (const a of list(pr.AWS)) {
    if (a === '*') return { ok: true, viaAccount: false };
    if (a === p.account || a === `arn:aws:iam::${p.account}:root`) return { ok: true, viaAccount: true };
    if (a === p.arn || arnMatches(a, p.arn)) return { ok: true, viaAccount: false };
  }
  return { ok: false, viaAccount: false };
}

export function statementMatches(s: Statement, req: Pick<EvalRequest, 'action' | 'resource' | 'context' | 'principal'>, use: Use): { ok: boolean; viaAccount?: boolean; why?: string } {
  if (s.Action !== undefined && !list(s.Action).some((a) => actionMatches(a, req.action))) return { ok: false, why: 'action' };
  if (s.NotAction !== undefined && list(s.NotAction).some((a) => actionMatches(a, req.action))) return { ok: false, why: 'action' };
  if (s.Resource !== undefined && !list(s.Resource).some((r) => arnMatches(r, req.resource))) return { ok: false, why: 'resource' };
  if (s.NotResource !== undefined && list(s.NotResource).some((r) => arnMatches(r, req.resource))) return { ok: false, why: 'resource' };
  let viaAccount = false;
  if (use === 'resource') {
    const m = principalMatch(s, req.principal);
    if (!m.ok) return { ok: false, why: 'principal' };
    viaAccount = m.viaAccount;
  }
  const c = evalConditionBlock(s.Condition, req.context);
  if (!c.ok) return { ok: false, why: `condition (${c.failed})` };
  return { ok: true, viaAccount };
}

function find(doc: PolicyDocument | null | undefined, effect: 'Allow' | 'Deny', req: EvalRequest, use: Use): Match | null {
  if (!doc) return null;
  for (let i = 0; i < doc.Statement.length; i++) {
    const s = doc.Statement[i];
    if (s.Effect !== effect) continue;
    const m = statementMatches(s, req, use);
    if (m.ok) return { statement: s, index: i, viaAccount: m.viaAccount };
  }
  return null;
}

const refOf = (h: { holder: string; holderKind: PolicyRef['holderKind']; name: string }, m: Match): PolicyRef => ({
  holder: h.holder,
  holderKind: h.holderKind,
  policyName: h.name,
  statementIndex: m.index,
  sid: m.statement.Sid,
});

const stmtName = (m: Match) => (m.statement.Sid ? `statement "${m.statement.Sid}"` : `statement #${m.index + 1}`);

export function evaluate(req: EvalRequest): IamDecision {
  const steps: IamStep[] = [];
  const p = req.principal;
  const call = `${req.action} on ${req.resourceLabel}`;
  const base = { action: req.action, resource: req.resource, principalArn: p.arn };
  const done = (decision: 'allow' | 'deny', reason: IamDecision['reason'], decisive?: PolicyRef): IamDecision => {
    steps.push({ kind: 'decision', result: decision, ref: decisive, explain: decision === 'allow' ? `ALLOW: ${p.label} may call ${call}.` : `DENY: ${p.label} may not call ${call} (${reason === 'explicit-deny' ? 'explicit deny' : 'implicit deny'}).` });
    return { ...base, decision, reason, steps, decisive };
  };
  const identityHeld = p.identity.map((n) => ({ doc: n.doc, name: n.name, holder: p.holderId, holderKind: 'role' as const }));
  const boundaryHeld = p.boundary ? [{ doc: p.boundary, name: 'permissions boundary', holder: p.holderId, holderKind: 'role' as const }] : [];
  const scpHeld = (req.scps ?? []).map((n) => ({ doc: n.doc, name: `SCP ${n.name}`, holder: 'scp', holderKind: 'scp' as const }));
  const inOrg = !p.service && (req.scps?.length ?? 0) > 0;

  // 1. Explicit deny anywhere.
  const pools: { held: HeldPolicy; use: Use }[] = [
    ...identityHeld.map((held) => ({ held, use: 'identity' as Use })),
    ...boundaryHeld.map((held) => ({ held, use: 'identity' as Use })),
    ...(inOrg ? scpHeld : []).map((held) => ({ held, use: 'identity' as Use })),
    ...(req.endpointPolicy ? [{ held: req.endpointPolicy, use: 'resource' as Use }] : []),
    ...(req.resourcePolicy ? [{ held: req.resourcePolicy, use: 'resource' as Use }] : []),
  ];
  for (const { held, use } of pools) {
    const m = find(held.doc, 'Deny', req, use);
    if (m) {
      const cond = describeCondition(m.statement.Condition);
      steps.push({ kind: 'explicit-deny', result: 'deny', ref: refOf(held, m), explain: `Explicit Deny in ${held.name}, ${stmtName(m)}${cond ? ` (condition true: ${cond})` : ''}. An explicit deny overrides every allow.` });
      return done('deny', 'explicit-deny', refOf(held, m));
    }
  }
  steps.push({ kind: 'explicit-deny', result: 'info', explain: `No explicit Deny matches in the ${pools.length} applicable polic${pools.length === 1 ? 'y' : 'ies'}.` });

  // 2. SCPs.
  if (inOrg) {
    let allowed: { held: HeldPolicy; m: Match } | null = null;
    for (const held of scpHeld) {
      const m = find(held.doc, 'Allow', req, 'identity');
      if (m) {
        allowed = { held, m };
        break;
      }
    }
    if (!allowed) {
      steps.push({ kind: 'scp', result: 'deny', ref: { holder: 'scp', holderKind: 'scp', policyName: scpHeld.map((s) => s.name).join(', ') }, explain: `The account is in an organization and no SCP allows ${req.action}. SCPs set the maximum permissions for every principal in the account, even administrators.` });
      return done('deny', 'implicit-deny', { holder: 'scp', holderKind: 'scp', policyName: 'SCPs' });
    }
    steps.push({ kind: 'scp', result: 'allow', ref: refOf(allowed.held, allowed.m), explain: `${allowed.held.name} allows ${req.action} (SCPs only filter; they never grant anything on their own).` });
  } else if (!p.service) steps.push({ kind: 'scp', result: 'skip', explain: 'The account is not in an organization with SCPs, so there is no SCP filter.' });

  // Endpoint policy.
  if (req.endpointPolicy) {
    const m = find(req.endpointPolicy.doc, 'Allow', req, 'resource');
    if (!m) {
      steps.push({ kind: 'endpoint-policy', result: 'deny', ref: { holder: req.endpointPolicy.holder, holderKind: 'endpoint', policyName: req.endpointPolicy.name }, explain: `The call goes through ${req.endpointPolicy.name}, and the endpoint policy doesn't allow it. Endpoint policies are a filter on every request through the endpoint.` });
      return done('deny', 'implicit-deny', { holder: req.endpointPolicy.holder, holderKind: 'endpoint', policyName: req.endpointPolicy.name });
    }
    steps.push({ kind: 'endpoint-policy', result: 'allow', ref: refOf(req.endpointPolicy, m), explain: `${req.endpointPolicy.name} allows the call through the endpoint.` });
  }

  // 3. Resource-based policy.
  const kind = req.resourceKind ?? 'generic';
  const sameAccount = !req.resourceAccount || req.resourceAccount === p.account;
  const rp = req.resourcePolicy;
  const rpAllow = rp ? find(rp.doc, 'Allow', req, 'resource') : null;
  const what = kind === 'kms' ? 'key policy' : kind === 'role' ? 'trust policy' : 'resource-based policy';
  const stepKind = kind === 'kms' ? 'key-policy' : kind === 'role' ? 'trust-policy' : 'resource-policy';
  let resourceDelegates = false;
  if (rpAllow && !rpAllow.viaAccount) {
    if (sameAccount || p.service) {
      steps.push({ kind: stepKind, result: 'allow', ref: refOf(rp!, rpAllow), explain: `${rp!.name} ${stmtName(rpAllow)} allows ${p.service ?? 'this principal'} directly. In the same account, a ${what} that names the principal grants access on its own.` });
      return done('allow', 'allowed', refOf(rp!, rpAllow));
    }
    steps.push({ kind: stepKind, result: 'allow', ref: refOf(rp!, rpAllow), explain: `${rp!.name} allows this principal from account ${p.account}. Cross-account access also needs an identity-based allow in the caller's account.` });
    resourceDelegates = true;
  } else if (rpAllow && rpAllow.viaAccount) {
    steps.push({ kind: stepKind, result: 'info', ref: refOf(rp!, rpAllow), explain: `${rp!.name} ${stmtName(rpAllow)} allows the account (${p.account}) as principal. That delegates the decision to IAM: the caller's identity-based policies must allow it.` });
    resourceDelegates = true;
  } else if (kind === 'kms' || kind === 'role') {
    steps.push({
      kind: stepKind,
      result: 'deny',
      ref: rp ? { holder: rp.holder, holderKind: rp.holderKind, policyName: rp.name } : undefined,
      explain:
        kind === 'kms'
          ? `The key policy of ${req.resourceLabel} neither allows ${p.label} nor delegates to the account (arn:aws:iam::${req.resourceAccount}:root). For KMS, the key policy is required: IAM policies alone can never grant access to a key.`
          : `The trust policy of ${req.resourceLabel} doesn't allow ${p.label} to assume it. Without the trust policy, no permission policy can grant sts:AssumeRole.`,
    });
    return done('deny', 'implicit-deny', rp ? { holder: rp.holder, holderKind: rp.holderKind, policyName: rp.name } : undefined);
  } else if (!sameAccount) {
    steps.push({ kind: 'resource-policy', result: 'deny', ref: rp ? { holder: rp.holder, holderKind: rp.holderKind, policyName: rp.name } : undefined, explain: `Cross-account call: ${req.resourceLabel} is in account ${req.resourceAccount}, and ${rp ? 'its resource policy does not allow' : 'it has no resource policy allowing'} ${p.label}. Both sides must allow.` });
    return done('deny', 'implicit-deny', rp ? { holder: rp.holder, holderKind: rp.holderKind, policyName: rp.name } : undefined);
  } else {
    steps.push({ kind: 'resource-policy', result: rp ? 'info' : 'skip', explain: rp ? `${rp.name} has no Allow for this principal and call; IAM policies can still grant it in the same account.` : `${req.resourceLabel} has no resource-based policy; access depends on the caller's IAM policies.` });
  }

  if (p.service) {
    steps.push({ kind: 'identity', result: 'deny', explain: `${p.service} is an AWS service principal: only a resource-based policy can grant it access.` });
    return done('deny', 'implicit-deny', rp ? { holder: rp.holder, holderKind: rp.holderKind, policyName: rp.name } : undefined);
  }

  // 4. Permissions boundary.
  if (p.boundary) {
    const m = find(p.boundary, 'Allow', req, 'identity');
    const held = boundaryHeld[0];
    if (!m) {
      steps.push({ kind: 'boundary', result: 'deny', ref: { holder: p.holderId, holderKind: 'role', policyName: 'permissions boundary' }, explain: `The permissions boundary on ${p.label} doesn't allow ${req.action}. A boundary caps what identity policies can grant: effective permissions are the intersection.` });
      return done('deny', 'implicit-deny', { holder: p.holderId, holderKind: 'role', policyName: 'permissions boundary' });
    }
    steps.push({ kind: 'boundary', result: 'allow', ref: refOf(held, m), explain: `The permissions boundary allows ${req.action} (it is a ceiling, not a grant).` });
  } else steps.push({ kind: 'boundary', result: 'skip', explain: 'No permissions boundary.' });

  // 5. Identity-based policies.
  for (const held of identityHeld) {
    const m = find(held.doc, 'Allow', req, 'identity');
    if (m) {
      steps.push({ kind: 'identity', result: 'allow', ref: refOf(held, m), explain: `${held.name} ${stmtName(m)} allows ${req.action} on ${req.resource}.${resourceDelegates ? ` Together with the ${what}, both sides allow.` : ''}` });
      return done('allow', 'allowed', refOf(held, m));
    }
  }
  const near = identityHeld.map((h) => h.doc.Statement.filter((s) => s.Effect === 'Allow').map((s) => statementMatches(s, req, 'identity').why)).flat().filter(Boolean);
  const hint = near.includes('action') ? ' (statements exist, but none lists this action)' : near.includes('resource') ? ' (the action is allowed, but not on this resource ARN)' : near.some((w) => w?.startsWith('condition')) ? ' (a matching statement exists, but its condition is false)' : '';
  steps.push({
    kind: 'identity',
    result: 'deny',
    ref: { holder: p.holderId, holderKind: 'role', policyName: identityHeld[0]?.name ?? 'identity policies' },
    explain: identityHeld.length ? `No identity-based policy on ${p.label} allows ${req.action} on ${req.resource}${hint}.` : `${p.label} has no identity-based policies attached.`,
  });
  steps.push({ kind: 'implicit-deny', result: 'deny', explain: 'Nothing allowed the request, so it is implicitly denied. Everything in AWS starts denied.' });
  return done('deny', 'implicit-deny', { holder: p.holderId, holderKind: 'role', policyName: identityHeld[0]?.name ?? 'identity policies' });
}
