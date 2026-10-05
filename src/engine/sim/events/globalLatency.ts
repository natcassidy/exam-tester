// Global users: where DNS sends each city, how far that is, and how far the data is from the
// app. Optionally checks a hot key against DynamoDB's per-partition read limit.

import type { Component, ConfigOf } from '../../model';
import { regionOf } from '../../board';
import { resolveDns } from '../../net/dns';
import { CITIES, cityRtt, regionRtt } from '../../net/geo';
import { resolveRef } from '../../select';
import { EventHandler, result } from './context';

export interface GlobalLatencyParams {
  cities?: string[];
  maxMs?: number;
  /** The players' requests write (true) or read. */
  writes?: boolean;
  dns?: string;
  table?: string;
  /** Reads per second of one hot item (e.g. the top-100 leaderboard), across all Regions. */
  hotKeyReadsPerSec?: number;
}

/** DynamoDB per-partition limit: 3,000 RCU = 6,000 eventually consistent reads/s of items up to 4 KB. */
export const PARTITION_EC_READS_PER_SEC = 6000;
export const DDB_MS = 5;
export const DAX_MS = 1;

export const globalLatency: EventHandler = (board, ev) => {
  const p = ev.params as GlobalLatencyParams;
  const table = resolveRef(board, p.table ?? 'dynamodb') as (Component & { config: ConfigOf<'dynamodb'> }) | undefined;
  if (!table) return result(ev, { status: 'fail', incomplete: true, summary: 'There is no table on the board yet.', lesson: 'Place the data store first.', highlight: [] });
  const tableRegions = [regionOf(board, table), ...(table.config.replicaRegions ?? [])];
  const dax = !!table.config.dax;

  if (p.hotKeyReadsPerSec) {
    const perRegion = Math.ceil(p.hotKeyReadsPerSec / tableRegions.length);
    const over = perRegion > PARTITION_EC_READS_PER_SEC;
    const ok = dax || !over;
    return result(ev, {
      status: ok ? 'pass' : 'fail',
      summary: dax
        ? `The hot item is read ~${perRegion.toLocaleString()} times/s per Region. DAX serves it from its item cache in microseconds; DynamoDB sees only cache misses.`
        : over
          ? `The hot item is read ~${perRegion.toLocaleString()} times/s in each of ${tableRegions.length} Region(s), but one partition serves at most ~${PARTITION_EC_READS_PER_SEC.toLocaleString()} eventually consistent 4 KB reads/s (3,000 RCU). Requests are throttled, on-demand or not.`
          : `~${perRegion.toLocaleString()} reads/s per Region of the hot item stays under the ~${PARTITION_EC_READS_PER_SEC.toLocaleString()}/s partition limit.`,
      detail: { lines: [{ label: 'Partition limit', value: '3,000 read capacity units and 1,000 write capacity units per partition. A single item always lives in one partition.' }] },
      lesson: 'A read-heavy hot key needs a cache in front of the table: DynamoDB Accelerator (DAX) for DynamoDB.',
      highlight: ok ? [] : [table.id],
      fixTarget: table.id,
    });
  }

  const dns = resolveRef(board, p.dns ?? 'route53');
  const cities = p.cities ?? ['virginia', 'london', 'sydney'];
  const maxMs = p.maxMs ?? 100;
  const lines: { label: string; value: string; status?: 'pass' | 'fail' }[] = [];
  let worst = 0;
  let worstCity = '';
  for (const city of cities) {
    let entry: Component | undefined;
    let why = '';
    if (dns?.config.type === 'route53') {
      const ans = resolveDns(board, dns.config, city);
      entry = ans.targetId ? board.components[ans.targetId] : undefined;
      why = ans.explain;
    } else entry = resolveRef(board, 'apigw') ?? resolveRef(board, 'alb');
    if (!entry) {
      lines.push({ label: CITIES[city]?.label ?? city, value: why || 'No entry point for this player.', status: 'fail' });
      worst = Infinity;
      worstCity = city;
      continue;
    }
    const er = regionOf(board, entry);
    const toApp = cityRtt(city, er);
    const nearest = [...tableRegions].sort((a, b) => regionRtt(er, a) - regionRtt(er, b))[0];
    const local = nearest === er;
    const dataMs = local ? (dax && !p.writes ? DAX_MS : DDB_MS) : regionRtt(er, nearest) + DDB_MS;
    const total = toApp + dataMs;
    if (total > worst) {
      worst = total;
      worstCity = city;
    }
    lines.push({
      label: CITIES[city]?.label ?? city,
      value: `${entry.name} in ${er} (~${toApp} ms) + ${p.writes ? 'write' : 'read'} on ${local ? `the local ${dax && !p.writes ? 'DAX cache' : 'table replica'}` : `the table in ${nearest}, another Region away`} (~${dataMs} ms) = ~${total} ms.`,
      status: total <= maxMs ? 'pass' : 'fail',
    });
  }
  const ok = worst <= maxMs;
  const bad = lines.find((l) => l.status === 'fail');
  return result(ev, {
    status: ok ? 'pass' : 'fail',
    summary: ok ? `Every player is within ${maxMs} ms (slowest: ${CITIES[worstCity]?.label ?? worstCity} at ~${worst} ms).` : `${CITIES[worstCity]?.label ?? worstCity}: ~${Number.isFinite(worst) ? worst : '∞'} ms, over the ${maxMs} ms target. ${bad?.value ?? ''}`,
    detail: { lines },
    lesson: ok ? 'Serve each player from the nearest Region, with the data in that Region too.' : 'Latency-based routing sends players to the closest healthy Region; DynamoDB global tables put a writable replica of the data there.',
    highlight: ok ? [] : [dns?.id ?? table.id],
    fixTarget: dns?.id ?? table.id,
    metrics: { latencyMs: worst },
  });
};
