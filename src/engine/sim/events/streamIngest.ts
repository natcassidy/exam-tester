// Streaming ingest: Kinesis Data Streams vs. Firehose vs. SQS. Shards from throughput, ordering,
// fan-out to several real-time consumers, replay, and delivery to S3 for Athena.

import type { Board, Component, ConfigOf } from '../../model';
import { componentsOfType } from '../../board';
import { EventHandler, result } from './context';

export interface StreamIngestParams {
  check: 'ingest' | 'ordering' | 'fanout' | 'replay' | 'analytics';
  eventsPerSec: number;
  avgKb: number;
  /** Independent real-time consumers that each need every event. */
  consumers?: number;
  replayHours?: number;
  /** Max delay from event to queryable in S3. */
  maxDelaySec?: number;
}

export const SHARD_IN_MBPS = 1;
export const SHARD_IN_RECORDS = 1000;
export const SHARD_OUT_MBPS = 2;

function streamOf(board: Board) {
  return componentsOfType(board, 'kinesis')[0];
}

function consumersOf(board: Board, stream: Component) {
  const lambdas = componentsOfType(board, 'lambda').filter((l) => l.config.eventSourceId === stream.id);
  const hoses = componentsOfType(board, 'firehose').filter((f) => f.config.sourceId === stream.id);
  return { lambdas, hoses };
}

export function requiredShards(eventsPerSec: number, avgKb: number): number {
  const mbps = (eventsPerSec * avgKb) / 1000;
  return Math.max(Math.ceil(mbps / SHARD_IN_MBPS), Math.ceil(eventsPerSec / SHARD_IN_RECORDS));
}

export const streamIngest: EventHandler = (board, ev) => {
  const p = ev.params as StreamIngestParams;
  const stream = streamOf(board) as (Component & { config: ConfigOf<'kinesis'> }) | undefined;
  const queue = componentsOfType(board, 'sqs')[0];
  const directHose = componentsOfType(board, 'firehose').find((f) => !f.config.sourceId);
  const mbps = (p.eventsPerSec * p.avgKb) / 1000;
  const need = requiredShards(p.eventsPerSec, p.avgKb);
  const fail = (summary: string, lesson: string, id?: string) => result(ev, { status: 'fail', summary, lesson, highlight: id ? [id] : [], fixTarget: id });
  const pass = (summary: string, lesson: string) => result(ev, { status: 'pass', summary, lesson, highlight: [] });

  if (!stream && !queue && !directHose) return fail('Nothing receives the events.', 'Pick an ingestion service: Kinesis Data Streams, Firehose or SQS.');

  if (p.check === 'ingest') {
    if (!stream) return pass(`${(queue ?? directHose)!.name} absorbs ${p.eventsPerSec.toLocaleString()} events/s (${mbps.toFixed(1)} MB/s): it scales without shards.`, 'SQS and Firehose scale automatically.');
    if (stream.config.mode === 'onDemand') return pass(`${stream.name} is on-demand: it scales its shards automatically for ${mbps.toFixed(1)} MB/s (it doubles toward the previous peak within minutes).`, 'On-demand mode trades a higher per-GB price for no shard management.');
    const ok = stream.config.shards >= need;
    const summary = `${p.eventsPerSec.toLocaleString()} events/s × ${p.avgKb} KB = ${mbps.toFixed(1)} MB/s. Each shard takes 1 MB/s or 1,000 records/s, so ${need} shards are needed; ${stream.name} has ${stream.config.shards}.`;
    return ok ? pass(summary, 'Shard count = max(MB/s ÷ 1, records/s ÷ 1,000), plus headroom.') : fail(`${summary} Producers get ProvisionedThroughputExceededException.`, 'Add shards (or switch to on-demand mode).', stream.id);
  }

  if (p.check === 'ordering') {
    if (stream) return pass(`${stream.name} keeps records in order within a shard. With the session id as the partition key, every session's clicks arrive in order.`, 'Kinesis: ordering per partition key (shard).');
    if (queue && queue.config.type === 'sqs' && queue.config.fifo) return pass(`${queue.name} is FIFO: ordered per message group (use the session id as the group id).`, 'SQS FIFO orders within a message group.');
    if (queue) return fail(`${queue.name} is a Standard queue: best-effort ordering and at-least-once delivery. Clicks from one session arrive out of order.`, 'Ordering needs Kinesis (per partition key) or SQS FIFO (per message group).', queue.id);
    return fail(`Firehose delivers batches to storage. It has no consumers that see events in order.`, 'Put a Kinesis data stream in front when consumers need ordered events.', directHose!.id);
  }

  if (p.check === 'fanout') {
    const n = p.consumers ?? 2;
    if (!stream) {
      if (queue) return fail(`${queue.name} is a queue: each message goes to one consumer and is deleted. ${n} consumers would split the events between them instead of each seeing all of them.`, 'Fan-out with queues needs SNS in front of one queue per consumer. A Kinesis stream lets any number of consumers read the same records.', queue.id);
      return fail('Firehose has no real-time consumers: it only delivers to a destination.', 'Use Kinesis Data Streams when applications must react to each event in real time.', directHose!.id);
    }
    const { lambdas, hoses } = consumersOf(board, stream);
    if (lambdas.length < n) return fail(`${n} real-time consumers must each read every event, but ${lambdas.length} function(s) read ${stream.name}.`, 'Give each consumer its own event source mapping on the stream.', stream.id);
    const efo = lambdas.filter((l) => l.config.enhancedFanOut);
    const shared = lambdas.length - efo.length + hoses.length;
    const shards = stream.config.mode === 'onDemand' ? need : stream.config.shards;
    const readCap = shards * SHARD_OUT_MBPS;
    const demand = shared * mbps;
    const lines = [
      { label: 'Shared readers', value: `${shared} (${[...lambdas.filter((l) => !l.config.enhancedFanOut).map((l) => l.name), ...hoses.map((h) => h.name)].join(', ') || 'none'}) × ${mbps.toFixed(1)} MB/s = ${demand.toFixed(1)} MB/s against ${shards} shards × 2 MB/s = ${readCap} MB/s shared.` },
      { label: 'Enhanced fan-out', value: efo.length ? `${efo.map((l) => l.name).join(', ')}: each gets its own 2 MB/s per shard, pushed (~70 ms).` : 'none' },
    ];
    if (demand > readCap)
      return result(ev, { status: 'fail', summary: `The consumers fall behind: shared readers need ${demand.toFixed(1)} MB/s but ${shards} shards give ${readCap} MB/s in total. Lag grows until records expire.`, detail: { lines }, lesson: 'Every shared consumer (Firehose included) splits the 2 MB/s per shard read limit. Add shards or give consumers enhanced fan-out.', highlight: [stream.id], fixTarget: stream.id });
    return result(ev, { status: 'pass', summary: `${lambdas.length} consumers each read every event in real time (${demand.toFixed(1)} of ${readCap} MB/s shared read capacity used${efo.length ? `, plus ${efo.length} enhanced fan-out` : ''}).`, detail: { lines }, lesson: 'Kinesis Data Streams: many consumers, each with its own position in the stream.', highlight: [] });
  }

  if (p.check === 'replay') {
    const h = p.replayHours ?? 24;
    if (!stream) return fail(`${(queue ?? directHose)!.name} can't replay: ${queue ? 'a message is deleted once processed' : 'Firehose keeps nothing after delivery'}. A buggy consumer can't re-read the last ${h} hours.`, 'Kinesis Data Streams keeps records for 24 hours by default (up to 365 days) and consumers can re-read from any point.', (queue ?? directHose)!.id);
    if (stream.config.retentionHours < h) return fail(`${stream.name} keeps records for ${stream.config.retentionHours} h; the team needs to replay ${h} h.`, 'Increase the retention period.', stream.id);
    return pass(`${stream.name} retains ${stream.config.retentionHours} h of records: a fixed consumer can rewind and reprocess the last ${h} h.`, 'Replay is a stream feature, not a queue feature.');
  }

  // analytics
  const maxDelay = p.maxDelaySec ?? 300;
  const hose = componentsOfType(board, 'firehose').find((f) => f.config.destId && board.components[f.config.destId]?.type === 's3');
  if (!hose) return fail('Nothing lands the events in S3 for Athena.', 'Kinesis Data Firehose delivers a stream to S3 in batches, optionally converting to Parquet.');
  const fed = hose.config.sourceId ? hose.config.sourceId === stream?.id : !stream;
  if (!fed) return fail(`${hose.name} is a Direct PUT stream, but producers send to ${stream!.name}. Nothing reaches it.`, 'Set the Kinesis data stream as the Firehose source.', hose.id);
  if (hose.config.bufferSec > maxDelay) return fail(`${hose.name} buffers for ${hose.config.bufferSec} s before writing to S3: events are queryable too late (requirement ${maxDelay} s).`, 'Firehose writes when the buffer interval or buffer size is reached, whichever comes first.', hose.id);
  const athena = componentsOfType(board, 'athena').find((a) => a.config.sourceId === hose.config.destId);
  if (!athena) return fail(`Data lands in ${board.components[hose.config.destId!].name}, but nothing queries it.`, 'Athena runs SQL directly on S3 (pay per TB scanned); the Glue Data Catalog holds the table schema.', hose.id);
  return pass(`${hose.name} writes ${hose.config.format === 'parquet' ? 'Parquet' : 'JSON'} to ${board.components[hose.config.destId!].name} at least every ${hose.config.bufferSec} s, and ${athena.name} queries it with SQL.`, hose.config.format === 'parquet' ? 'Columnar Parquet means Athena reads only the columns a query needs.' : 'Converting to Parquet would cut the data Athena scans (and bills) per query.');
};
