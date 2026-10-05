import type { Nacl, NaclRule, Protocol } from '../model';
import { cidrContainsIp, isValidCidr } from './cidr';
import { portInRange, protocolMatches } from './sg';

export const EPHEMERAL: [number, number] = [1024, 65535];

export interface NaclDecision {
  action: 'allow' | 'deny';
  /** Rule number that matched, or '*' for the implicit deny. */
  ruleNumber: number | '*';
  rule?: NaclRule;
}

export function sortedRules(rules: NaclRule[]): NaclRule[] {
  return [...rules].sort((a, b) => a.ruleNumber - b.ruleNumber);
}

/**
 * NACLs are stateless and ordered: rules are evaluated lowest number first and the
 * first match wins. If nothing matches, the implicit "*" rule denies.
 */
export function evaluateNacl(nacl: Nacl, direction: 'inbound' | 'outbound', protocol: Protocol, port: number, peerIp: string): NaclDecision {
  for (const r of sortedRules(nacl[direction])) {
    if (protocolMatches(r.protocol, protocol) && portInRange(r.protocol, r.portRange[0], r.portRange[1], port) && isValidCidr(r.cidr) && cidrContainsIp(r.cidr, peerIp)) {
      return { action: r.action, ruleNumber: r.ruleNumber, rule: r };
    }
  }
  return { action: 'deny', ruleNumber: '*' };
}

/** Return traffic uses an ephemeral port. Clients pick from 1024-65535 (Linux uses 32768-60999). */
export const RETURN_PORT = 49152;

export function validateNaclRule(rules: NaclRule[], rule: NaclRule, ignoreIndex = -1): string | null {
  if (!Number.isInteger(rule.ruleNumber) || rule.ruleNumber < 1 || rule.ruleNumber > 32766)
    return 'Rule number must be an integer between 1 and 32766.';
  if (rules.some((r, i) => i !== ignoreIndex && r.ruleNumber === rule.ruleNumber))
    return `Rule number ${rule.ruleNumber} already exists in this direction. Rule numbers must be unique.`;
  if (!isValidCidr(rule.cidr)) return `"${rule.cidr}" is not a valid CIDR block.`;
  if (rule.protocol !== 'all' && rule.protocol !== 'icmp') {
    const [a, b] = rule.portRange;
    if (a < 0 || b > 65535 || a > b) return 'Port range must be within 0-65535 and from ≤ to.';
  }
  return null;
}
