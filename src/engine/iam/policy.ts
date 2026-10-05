// Policy parsing and AWS-style validation. Errors read like IAM's MalformedPolicyDocument messages.

import type { PolicyDocument, Statement } from './types';
import { baseOperator, SUPPORTED_OPERATORS } from './conditions';
import { list } from './match';

export type PolicyKind = 'identity' | 'resource' | 'trust' | 'scp' | 'boundary' | 'endpoint';

const STATEMENT_FIELDS = new Set(['Sid', 'Effect', 'Principal', 'Action', 'NotAction', 'Resource', 'NotResource', 'Condition']);

export type ParseResult = { ok: true; doc: PolicyDocument } | { ok: false; errors: string[] };

export function parsePolicy(text: string, kind: PolicyKind): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`MalformedPolicyDocument: the policy is not valid JSON (${(e as Error).message}).`] };
  }
  return validatePolicy(raw, kind);
}

export function validatePolicy(raw: unknown, kind: PolicyKind): ParseResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['MalformedPolicyDocument: a policy must be a JSON object.'] };
  const d = raw as Record<string, unknown>;
  for (const k of Object.keys(d)) if (!['Version', 'Id', 'Statement'].includes(k)) errors.push(`MalformedPolicyDocument: unknown top-level field "${k}".`);
  if (d.Version !== '2012-10-17' && d.Version !== '2008-10-17') errors.push('MalformedPolicyDocument: "Version" must be "2012-10-17" (always use the current version).');
  const stmts = Array.isArray(d.Statement) ? d.Statement : d.Statement && typeof d.Statement === 'object' ? [d.Statement] : null;
  if (!stmts || !stmts.length) errors.push('MalformedPolicyDocument: the policy must contain at least one "Statement".');
  const out: Statement[] = [];
  (stmts ?? []).forEach((s0, i) => {
    const where = `Statement ${i + 1}${s0 && typeof s0 === 'object' && (s0 as Statement).Sid ? ` (${(s0 as Statement).Sid})` : ''}`;
    if (!s0 || typeof s0 !== 'object' || Array.isArray(s0)) {
      errors.push(`MalformedPolicyDocument: ${where} must be an object.`);
      return;
    }
    const s = s0 as Record<string, unknown>;
    for (const k of Object.keys(s)) {
      if (k === 'NotPrincipal') errors.push(`${where}: NotPrincipal is not supported in this game (AWS discourages it too). Use Principal with a Deny and a condition.`);
      else if (!STATEMENT_FIELDS.has(k)) errors.push(`MalformedPolicyDocument: ${where} has unknown field "${k}".`);
    }
    if (s.Effect !== 'Allow' && s.Effect !== 'Deny') errors.push(`MalformedPolicyDocument: ${where} "Effect" must be "Allow" or "Deny" (case-sensitive).`);
    const hasA = s.Action !== undefined;
    const hasNA = s.NotAction !== undefined;
    if (hasA === hasNA) errors.push(`MalformedPolicyDocument: ${where} must have exactly one of "Action" or "NotAction".`);
    for (const a of list(s.Action ?? s.NotAction) as unknown[]) {
      if (typeof a !== 'string' || (a !== '*' && !/^[a-zA-Z0-9-]+:[a-zA-Z0-9*?]+$/.test(a))) errors.push(`MalformedPolicyDocument: ${where} action "${String(a)}" must look like "service:Operation" (wildcards * and ? allowed).`);
    }
    const hasR = s.Resource !== undefined;
    const hasNR = s.NotResource !== undefined;
    if (hasR && hasNR) errors.push(`MalformedPolicyDocument: ${where} can't have both "Resource" and "NotResource".`);
    if (kind === 'trust') {
      if (hasR || hasNR) errors.push(`MalformedPolicyDocument: ${where}: a role trust policy has no Resource (the resource is the role itself).`);
    } else if (!hasR && !hasNR && kind !== 'scp') errors.push(`MalformedPolicyDocument: ${where} is missing "Resource".`);
    for (const r of list(s.Resource ?? s.NotResource) as unknown[]) {
      if (typeof r !== 'string' || (r !== '*' && !r.startsWith('arn:'))) errors.push(`MalformedPolicyDocument: ${where} resource "${String(r)}" must be "*" or an ARN.`);
    }
    const needsPrincipal = kind === 'resource' || kind === 'trust' || kind === 'endpoint';
    if (needsPrincipal && s.Principal === undefined) errors.push(`MalformedPolicyDocument: ${where} is missing "Principal". Resource-based policies must say who they apply to.`);
    if (!needsPrincipal && s.Principal !== undefined) errors.push(`MalformedPolicyDocument: ${where} has prohibited field "Principal". ${kind === 'identity' || kind === 'boundary' ? 'Identity-based policies apply to whoever they are attached to.' : 'SCPs apply to every principal in the account.'}`);
    if (s.Principal !== undefined && s.Principal !== '*') {
      const p = s.Principal as Record<string, unknown>;
      if (typeof p !== 'object' || Array.isArray(p) || !Object.keys(p).every((k) => k === 'AWS' || k === 'Service')) errors.push(`MalformedPolicyDocument: ${where} "Principal" must be "*" or an object with "AWS" and/or "Service".`);
    }
    if (s.Condition !== undefined) {
      if (!s.Condition || typeof s.Condition !== 'object') errors.push(`MalformedPolicyDocument: ${where} "Condition" must be an object.`);
      else
        for (const op of Object.keys(s.Condition as object)) {
          if (!(SUPPORTED_OPERATORS as readonly string[]).includes(baseOperator(op).base)) errors.push(`${where}: condition operator "${op}" is not supported here. Supported: ${SUPPORTED_OPERATORS.join(', ')} (and ...IfExists).`);
        }
    }
    out.push(s as unknown as Statement);
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, doc: { Version: d.Version as PolicyDocument['Version'], ...(d.Id ? { Id: String(d.Id) } : {}), Statement: out } };
}

export function policyText(doc: PolicyDocument | null | undefined): string {
  return doc ? JSON.stringify(doc, null, 2) : '';
}

export const doc = (...Statement: Statement[]): PolicyDocument => ({ Version: '2012-10-17', Statement });
