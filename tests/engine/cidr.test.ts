import { describe, expect, it } from 'vitest';
import { cidrContainsCidr, cidrContainsIp, cidrsOverlap, hostIp, isCanonicalCidr, longestPrefixMatch, parseCidr } from '../../src/engine/net/cidr';

describe('cidr', () => {
  it('parses and normalises', () => {
    expect(parseCidr('10.0.1.0/24')).toEqual({ base: (10 << 24 >>> 0) + 256, prefix: 24 });
    expect(isCanonicalCidr('10.0.1.0/24')).toBe(true);
    expect(isCanonicalCidr('10.0.1.5/24')).toBe(false);
    expect(() => parseCidr('10.0.0.0/33')).toThrow();
    expect(() => parseCidr('10.0.0.256/24')).toThrow();
  });

  it('matches IPs inside a block', () => {
    expect(cidrContainsIp('10.0.0.0/16', '10.0.200.7')).toBe(true);
    expect(cidrContainsIp('10.0.0.0/16', '10.1.0.1')).toBe(false);
    expect(cidrContainsIp('0.0.0.0/0', '203.0.113.10')).toBe(true);
    expect(cidrContainsIp('192.168.1.10/32', '192.168.1.10')).toBe(true);
  });

  it('compares blocks', () => {
    expect(cidrContainsCidr('10.0.0.0/16', '10.0.5.0/24')).toBe(true);
    expect(cidrContainsCidr('10.0.5.0/24', '10.0.0.0/16')).toBe(false);
    expect(cidrsOverlap('10.0.0.0/16', '10.0.128.0/17')).toBe(true);
    expect(cidrsOverlap('10.0.0.0/16', '10.1.0.0/16')).toBe(false);
  });

  it('skips the 4 addresses AWS reserves at the start of a subnet', () => {
    expect(hostIp('10.0.1.0/24', 0)).toBe('10.0.1.4');
  });

  it('longest-prefix match picks the most specific route', () => {
    const routes = ['0.0.0.0/0', '10.0.0.0/16', '10.0.1.0/24'];
    expect(longestPrefixMatch(routes, '10.0.1.9')).toBe(2);
    expect(longestPrefixMatch(routes, '10.0.9.9')).toBe(1);
    expect(longestPrefixMatch(routes, '8.8.8.8')).toBe(0);
    expect(longestPrefixMatch(['10.0.0.0/16'], '8.8.8.8')).toBe(-1);
  });
});
