// ARN, action and wildcard matching for IAM policies.

import { cidrContainsIp, isValidCidr } from '../net/cidr';

/** Glob match with IAM wildcards: `*` (any run of characters) and `?` (one character). */
export function globMatch(pattern: string, value: string, ignoreCase = false): boolean {
  const p = ignoreCase ? pattern.toLowerCase() : pattern;
  const v = ignoreCase ? value.toLowerCase() : value;
  const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 's');
  return re.test(v);
}

/** Actions are "service:Operation"; matching is case-insensitive. */
export function actionMatches(pattern: string, action: string): boolean {
  if (pattern === '*') return true;
  return globMatch(pattern, action, true);
}

export interface Arn {
  partition: string;
  service: string;
  region: string;
  account: string;
  resource: string;
}

export function parseArn(arn: string): Arn | null {
  const parts = arn.split(':');
  if (parts.length < 6 || parts[0] !== 'arn') return null;
  return { partition: parts[1], service: parts[2], region: parts[3], account: parts[4], resource: parts.slice(5).join(':') };
}

/**
 * ARN matching: each of the colon-separated sections is matched on its own, so a wildcard
 * never spans sections. The resource section may itself contain colons and slashes.
 */
export function arnMatches(pattern: string, arn: string): boolean {
  if (pattern === '*') return true;
  const p = parseArn(pattern);
  const a = parseArn(arn);
  if (!p || !a) return globMatch(pattern, arn);
  return (
    globMatch(p.partition, a.partition) &&
    globMatch(p.service, a.service) &&
    globMatch(p.region, a.region) &&
    globMatch(p.account, a.account) &&
    globMatch(p.resource, a.resource)
  );
}

export function ipMatches(cidrOrIp: string, ip: string): boolean {
  const c = cidrOrIp.includes('/') ? cidrOrIp : `${cidrOrIp}/32`;
  return isValidCidr(c) && /^\d+\.\d+\.\d+\.\d+$/.test(ip) && cidrContainsIp(c, ip);
}

export const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Account id of a principal or resource ARN (empty for S3 bucket ARNs, which carry none). */
export function accountOf(arn: string): string {
  return parseArn(arn)?.account ?? '';
}
