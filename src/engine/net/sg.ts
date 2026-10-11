import type { Board, Component, Protocol, SecurityGroup, SgRule, SgSource } from '../model';
import { cidrContainsIp, isValidCidr } from './cidr';
import { PREFIX_LISTS } from './routing';

export interface SgPeer {
  ip: string;
  /** Security groups attached to the peer's ENI (for SG-referencing rules). */
  sgIds: string[];
}

export interface SgDecision {
  allowed: boolean;
  matched?: { sgId: string; ruleIndex: number; rule: SgRule };
}

export function protocolMatches(ruleProto: Protocol, proto: Protocol): boolean {
  return ruleProto === 'all' || ruleProto === proto;
}

export function portInRange(proto: Protocol, from: number, to: number, port: number): boolean {
  if (proto === 'all' || proto === 'icmp') return true;
  return port >= from && port <= to;
}

export function sourceMatches(source: SgSource, peer: SgPeer): boolean {
  if ('cidr' in source) return isValidCidr(source.cidr) && cidrContainsIp(source.cidr, peer.ip);
  if ('sg' in source) return peer.sgIds.includes(source.sg);
  const pl = PREFIX_LISTS[source.prefixList];
  return !!pl && pl.cidrs.some((c) => cidrContainsIp(c, peer.ip));
}

export function sourceLabel(board: Board, source: SgSource): string {
  if ('cidr' in source) return source.cidr;
  if ('sg' in source) return board.securityGroups[source.sg]?.name ?? source.sg;
  return source.prefixList;
}

/**
 * Security groups are allow-only and evaluated as a union: traffic is allowed
 * if any rule in any attached group allows it. There is no rule order and no deny.
 */
export function evaluateSgs(
  groups: SecurityGroup[],
  direction: 'inbound' | 'outbound',
  protocol: Protocol,
  port: number,
  peer: SgPeer,
): SgDecision {
  for (const sg of groups) {
    const rules = sg[direction];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (protocolMatches(r.protocol, protocol) && portInRange(r.protocol, r.fromPort, r.toPort, port) && sourceMatches(r.source, peer)) {
        return { allowed: true, matched: { sgId: sg.id, ruleIndex: i, rule: r } };
      }
    }
  }
  return { allowed: false };
}

/** "TCP 443", "TCP 1024-65535" or "all traffic". */
export function sgPorts(r: SgRule): string {
  return r.protocol === 'all' ? 'all traffic' : r.fromPort === r.toPort ? `${r.protocol.toUpperCase()} ${r.fromPort}` : `${r.protocol.toUpperCase()} ${r.fromPort}-${r.toPort}`;
}

/** A rule open to the whole IPv4 internet. */
export const fromWorld = (r: SgRule): boolean => 'cidr' in r.source && r.source.cidr === '0.0.0.0/0';

export function describeSgRule(board: Board, r: SgRule): string {
  return `${sgPorts(r)} ${sourceLabel(board, r.source)}`;
}

/** Components wearing a security group. */
export function sgOwners(board: Board, sgId: string): Component[] {
  return Object.values(board.components).filter((c) => c.securityGroupIds?.includes(sgId));
}

/**
 * The components a group belongs to: those wearing it as their first group (the one created with
 * them). Anyone else wearing it borrowed it. When nobody wears it first, every owner is a home.
 */
export function sgHomes(board: Board, sgId: string): Component[] {
  const all = sgOwners(board, sgId);
  const first = all.filter((c) => c.securityGroupIds![0] === sgId);
  return first.length ? first : all;
}

/** The component `c` borrowed a group from, if it wears another component's group. */
export function sgLender(board: Board, c: Component, sgId: string): Component | undefined {
  const homes = sgHomes(board, sgId);
  return homes.some((h) => h.id === c.id) ? undefined : homes[0];
}
