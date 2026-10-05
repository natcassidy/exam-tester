// IPv4 CIDR helpers.

export interface ParsedCidr {
  base: number; // network address as an unsigned 32-bit int
  prefix: number;
}

export function ipToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new Error(`Invalid IPv4 address: ${ip}`);
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) throw new Error(`Invalid IPv4 address: ${ip}`);
    const v = Number(p);
    if (v > 255) throw new Error(`Invalid IPv4 address: ${ip}`);
    n = n * 256 + v;
  }
  return n >>> 0;
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

function mask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function parseCidr(cidr: string): ParsedCidr {
  const [ip, p] = cidr.split('/');
  if (p === undefined || !/^\d{1,2}$/.test(p)) throw new Error(`Invalid CIDR block: ${cidr}`);
  const prefix = Number(p);
  if (prefix > 32) throw new Error(`Invalid CIDR block: ${cidr}`);
  const base = (ipToInt(ip) & mask(prefix)) >>> 0;
  return { base, prefix };
}

export function isValidCidr(cidr: string): boolean {
  try {
    parseCidr(cidr);
    return true;
  } catch {
    return false;
  }
}

/** True if the CIDR's address bits beyond the prefix are zero (AWS rejects e.g. 10.0.0.5/24 for subnets). */
export function isCanonicalCidr(cidr: string): boolean {
  try {
    const [ip] = cidr.split('/');
    return parseCidr(cidr).base === ipToInt(ip);
  } catch {
    return false;
  }
}

export function cidrContainsIp(cidr: string, ip: string): boolean {
  const { base, prefix } = parseCidr(cidr);
  return ((ipToInt(ip) & mask(prefix)) >>> 0) === base;
}

/** True if `inner` is fully inside `outer`. */
export function cidrContainsCidr(outer: string, inner: string): boolean {
  const o = parseCidr(outer);
  const i = parseCidr(inner);
  return i.prefix >= o.prefix && ((i.base & mask(o.prefix)) >>> 0) === o.base;
}

export function cidrsOverlap(a: string, b: string): boolean {
  return cidrContainsCidr(a, b) || cidrContainsCidr(b, a);
}

/** Nth usable host in a subnet. AWS reserves the first four and the last address. */
export function hostIp(cidr: string, index: number): string {
  const { base, prefix } = parseCidr(cidr);
  const size = 2 ** (32 - prefix);
  const offset = 4 + (index % Math.max(1, size - 5));
  return intToIp((base + offset) >>> 0);
}

/**
 * Longest-prefix match. Returns the index of the best candidate whose CIDR contains the IP,
 * or -1 when nothing matches.
 */
export function longestPrefixMatch(cidrs: string[], ip: string): number {
  let best = -1;
  let bestPrefix = -1;
  cidrs.forEach((c, i) => {
    if (!isValidCidr(c)) return;
    const { prefix } = parseCidr(c);
    if (prefix > bestPrefix && cidrContainsIp(c, ip)) {
      best = i;
      bestPrefix = prefix;
    }
  });
  return best;
}
