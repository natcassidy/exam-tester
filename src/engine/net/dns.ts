// Route 53 routing policies: which record a resolver gets, given where the client is and which
// Regions are down. Health checks decide what "down" means: a record without one is always
// treated as healthy, so Route 53 keeps handing out a dead endpoint.

import type { Board, Route53Config, Route53Record } from '../model';
import { regionOf } from '../board';
import { CITIES, cityRtt, regionName } from './geo';

export const R53_DEFAULT_TTL = 300;
/** Alias records answer with the target's TTL; for an ELB that is 60 seconds. */
export const ALIAS_TTL = 60;

export function policyOf(cfg: Route53Config) {
  return cfg.policy ?? 'simple';
}

export function recordsOf(cfg: Route53Config): Route53Record[] {
  if (policyOf(cfg) === 'simple') return [{ id: 'simple', targetId: cfg.aliasTargetId, healthCheck: false }];
  return cfg.records ?? [];
}

export function effectiveTtl(cfg: Route53Config): number {
  return cfg.alias === false ? cfg.ttlSec ?? R53_DEFAULT_TTL : ALIAS_TTL;
}

/** Time for Route 53 health checkers to declare an endpoint unhealthy: interval × failure threshold. */
export function detectionSec(cfg: Route53Config): number {
  return (cfg.healthCheck?.intervalSec ?? 30) * (cfg.healthCheck?.failureThreshold ?? 3);
}

export interface DnsCandidate {
  record: Route53Record;
  region: string;
  healthy: boolean;
}

export interface DnsAnswer {
  targetId: string | null;
  explain: string;
  candidates: DnsCandidate[];
}

export function resolveDns(board: Board, cfg: Route53Config, city = 'virginia', failedRegions: string[] = []): DnsAnswer {
  const policy = policyOf(cfg);
  const cands: DnsCandidate[] = recordsOf(cfg)
    .filter((r) => r.targetId && board.components[r.targetId])
    .map((r) => {
      const region = regionOf(board, board.components[r.targetId!]);
      const down = failedRegions.includes(region);
      return { record: r, region, healthy: !down || !r.healthCheck };
    });
  const name = (c: DnsCandidate) => `${board.components[c.record.targetId!].name} (${c.region === 'global' ? 'global' : c.region})`;
  const none = (explain: string): DnsAnswer => ({ targetId: null, explain, candidates: cands });
  if (!cands.length) return none(`${cfg.recordName}: no record has a target, so DNS returns no answer.`);
  const healthy = cands.filter((c) => c.healthy);
  const pool = healthy.length ? healthy : cands;
  const allDown = !healthy.length ? ' Every record is unhealthy, so Route 53 answers as if all were healthy.' : '';
  const hcNote = (c: DnsCandidate) => (failedRegions.includes(c.region) && !c.record.healthCheck ? ` ${name(c)} has no health check, so Route 53 keeps returning it although its Region is down.` : '');
  const cityLabel = CITIES[city]?.label ?? city;

  switch (policy) {
    case 'simple': {
      const c = cands[0];
      return { targetId: c.record.targetId, explain: `Simple routing: ${cfg.recordName} always answers ${name(c)}. Simple records can't have health checks.`, candidates: cands };
    }
    case 'failover': {
      const primary = cands.find((c) => c.record.failover === 'primary');
      const secondary = cands.find((c) => c.record.failover === 'secondary');
      if (primary && (primary.healthy || !secondary)) return { targetId: primary.record.targetId, explain: `Failover routing: the primary ${name(primary)} is ${primary.healthy ? 'healthy' : 'unhealthy but there is no secondary'}.${hcNote(primary)}`, candidates: cands };
      if (secondary && (secondary.healthy || !primary)) return { targetId: secondary.record.targetId, explain: `Failover routing: the primary is unhealthy, so Route 53 answers with the secondary ${name(secondary)}.`, candidates: cands };
      const c = primary ?? cands[0];
      return { targetId: c.record.targetId, explain: `Failover routing: both records are unhealthy, so Route 53 returns the primary.`, candidates: cands };
    }
    case 'weighted': {
      const total = pool.reduce((s, c) => s + (c.record.weight ?? 0), 0);
      const best = [...pool].sort((a, b) => (b.record.weight ?? 0) - (a.record.weight ?? 0))[0];
      return { targetId: best.record.targetId, explain: `Weighted routing: ${pool.map((c) => `${name(c)} ${total ? Math.round(((c.record.weight ?? 0) / total) * 100) : 0}%`).join(', ')}. This client got ${name(best)}.${allDown}${cands.map(hcNote).join('')}`, candidates: cands };
    }
    case 'latency': {
      const best = [...pool].sort((a, b) => cityRtt(city, a.region) - cityRtt(city, b.region))[0];
      return { targetId: best.record.targetId, explain: `Latency routing: from ${cityLabel} the lowest-latency healthy Region is ${regionName(best.region)} (~${cityRtt(city, best.region)} ms).${allDown}${cands.map(hcNote).join('')}`, candidates: cands };
    }
    case 'geoproximity': {
      const score = (c: DnsCandidate) => cityRtt(city, c.region) * (1 - (c.record.bias ?? 0) / 100);
      const best = [...pool].sort((a, b) => score(a) - score(b))[0];
      return { targetId: best.record.targetId, explain: `Geoproximity routing: ${cityLabel} is closest to ${name(best)} after bias.${allDown}`, candidates: cands };
    }
    case 'geolocation': {
      const continent = CITIES[city]?.continent ?? 'NA';
      const exact = cands.find((c) => c.record.location === continent);
      const def = cands.find((c) => c.record.location === '*');
      const pick = exact && exact.healthy ? exact : def && def.healthy ? def : exact ?? def;
      if (!pick) return none(`Geolocation routing: no record matches ${cityLabel} (${continent}) and there is no default record, so Route 53 returns no answer. Always add a default location.`);
      return { targetId: pick.record.targetId, explain: `Geolocation routing: ${cityLabel} is in ${continent}; ${pick === exact ? 'its own record' : 'the default record'} answers with ${name(pick)}.${hcNote(pick)}`, candidates: cands };
    }
    case 'multivalue': {
      const answer = pool.slice(0, 8);
      return { targetId: answer[0].record.targetId, explain: `Multivalue answer: Route 53 returns up to 8 healthy records (${answer.map(name).join(', ')}); the client picks one.${allDown}`, candidates: cands };
    }
  }
}
