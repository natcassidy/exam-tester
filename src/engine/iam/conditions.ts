// Condition operators. Supported subset: String(Not)Equals, String(Not)Like, Bool,
// (Not)IpAddress, Arn(Not)Equals, Arn(Not)Like, each optionally with an ...IfExists suffix.

import type { ConditionBlock, RequestContext, StringOrList } from './types';
import { arnMatches, globMatch, ipMatches, list } from './match';

export const SUPPORTED_OPERATORS = [
  'StringEquals',
  'StringNotEquals',
  'StringLike',
  'StringNotLike',
  'Bool',
  'IpAddress',
  'NotIpAddress',
  'ArnEquals',
  'ArnNotEquals',
  'ArnLike',
  'ArnNotLike',
] as const;

/** Condition keys this game puts in the request context. */
export const SUPPORTED_KEYS = [
  'aws:SecureTransport',
  'aws:MultiFactorAuthPresent',
  'aws:SourceIp',
  'aws:SourceVpce',
  'aws:SourceVpc',
  'aws:PrincipalOrgID',
  'aws:PrincipalArn',
  'aws:PrincipalAccount',
  'aws:SourceArn',
  'aws:SourceAccount',
  'kms:ViaService',
  's3:x-amz-server-side-encryption',
] as const;

export function baseOperator(op: string): { base: string; ifExists: boolean } {
  return op.endsWith('IfExists') ? { base: op.slice(0, -'IfExists'.length), ifExists: true } : { base: op, ifExists: false };
}

export function lookupKey(ctx: RequestContext, key: string): string | boolean | undefined {
  const k = key.toLowerCase();
  for (const [name, v] of Object.entries(ctx)) if (name.toLowerCase() === k) return v;
  return undefined;
}

const NEGATED = new Set(['StringNotEquals', 'StringNotLike', 'NotIpAddress', 'ArnNotEquals', 'ArnNotLike']);

function test(base: string, ctxValue: string, policyValue: string): boolean {
  switch (base) {
    case 'StringEquals':
    case 'StringNotEquals':
      return ctxValue === policyValue;
    case 'StringLike':
    case 'StringNotLike':
      return globMatch(policyValue, ctxValue);
    case 'IpAddress':
    case 'NotIpAddress':
      return ipMatches(policyValue, ctxValue);
    case 'ArnEquals':
    case 'ArnNotEquals':
      return ctxValue === policyValue;
    case 'ArnLike':
    case 'ArnNotLike':
      return arnMatches(policyValue, ctxValue);
    default:
      return false;
  }
}

/**
 * One operator/key pair. Values in a list are ORed. A missing key makes positive operators
 * false and negated operators true, unless ...IfExists is used (then a missing key is true).
 */
export function evalCondition(op: string, key: string, values: StringOrList | boolean, ctx: RequestContext): boolean {
  const { base, ifExists } = baseOperator(op);
  const v = lookupKey(ctx, key);
  if (v === undefined) return ifExists || NEGATED.has(base);
  if (base === 'Bool') {
    const want = list<string | boolean>(values as string | boolean | string[]).map((x) => String(x).toLowerCase());
    return want.includes(String(v).toLowerCase());
  }
  const vals = list(values as StringOrList).map(String);
  const any = vals.some((pv) => test(base, String(v), pv));
  return NEGATED.has(base) ? !any : any;
}

/** All operators and keys in a Condition block are ANDed. */
export function evalConditionBlock(block: ConditionBlock | undefined, ctx: RequestContext): { ok: boolean; failed?: string } {
  if (!block) return { ok: true };
  for (const [op, keys] of Object.entries(block)) {
    for (const [key, values] of Object.entries(keys)) {
      if (!evalCondition(op, key, values, ctx)) return { ok: false, failed: `${op} ${key}` };
    }
  }
  return { ok: true };
}

export function describeCondition(block: ConditionBlock | undefined): string {
  if (!block) return '';
  return Object.entries(block)
    .flatMap(([op, keys]) => Object.entries(keys).map(([k, v]) => `${op} ${k} = ${JSON.stringify(v)}`))
    .join(' AND ');
}
