// Section 17 (decoupling applications: SQS, SNS, Kinesis, Amazon MQ).

import { BoardBuilder } from '../../engine/builder';
import type { StreamIngestParams } from '../../engine/sim/events/streamIngest';
import { lab, regionOnly, usage0 } from './helpers';

// =====================================================================================
// 17a. Every invoice emailed three times (fix): visibility timeout, dead-letter queue, concurrency cap.
// =====================================================================================

const month = [
  { min: 0, rps: 1 },
  { min: 5, rps: 1 },
  { min: 6, rps: 8 },
  { min: 26, rps: 8 },
  { min: 27, rps: 1 },
  { min: 60, rps: 1 },
];

function mailer(queue: Record<string, unknown>, worker: Record<string, unknown> = {}, dlq = true): BoardBuilder {
  const b = new BoardBuilder(regionOnly(), 'helpful')
    .place('apigw', '', { name: 'billing-api' })
    .place('sqs', '', { name: 'invoices' })
    .place('lambda', '', { name: 'invoice-mailer' })
    .config('billing-api', { integration: { kind: 'sqs', targetId: 'invoices' } })
    .config('invoice-mailer', { eventSourceId: 'invoices', timeoutSec: 30, reservedConcurrency: 100, memoryMb: 512, ...worker });
  if (dlq) b.place('sqs', '', { name: 'invoices-dlq' }).config('invoices-dlq', { retentionSec: 1209600 });
  return b.config('invoices', { visibilityTimeoutSec: 180, ...(dlq ? { dlqId: 'invoices-dlq', maxReceiveCount: 5 } : {}), ...queue });
}

export const sqsLab = lab({
  id: 'c-msg-sqs',
  course: { section: 17, kind: 'fix', lectures: ['Amazon SQS - Standard Queues Overview', 'SQS - Message Visibility Timeout', 'SQS - Dead Letter Queues', 'SQS + Auto Scaling Group'] },
  title: 'Every invoice, three times',
  client: 'Brightledger, invoicing for freelancers',
  users: 'Month-end: thousands of invoices rendered to PDF and emailed in half an hour',
  brief:
    "At month-end our customers' clients got the same invoice two or three times, and a few malformed invoices kept retrying all night. Each invoice takes about 20 seconds to render and send. Our email provider allows at most 100 sends at once. Every good invoice must go out exactly once within an hour; bad ones should be set aside for us to look at.",
  requirements: [
    { id: 'r1', text: 'Each invoice is emailed once (no duplicates)' },
    { id: 'r2', text: 'Malformed invoices are set aside instead of retrying forever' },
    { id: 'r3', text: 'Never more than 100 concurrent sends; everything out within an hour' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['apigw', 'sqs', 'lambda', 'dynamodb'],
  start: { board: mailer({ visibilityTimeoutSec: 10 }, { reservedConcurrency: null }, false).done(), fails: ['month-end'] },
  events: [
    {
      id: 'month-end',
      name: 'Month-end run',
      desc: 'Invoices jump from 1/s to 8/s for 20 minutes. Each takes 20 s; 0.5% are malformed; the email provider allows 100 concurrent sends.',
      domain: 'resilient',
      concepts: ['sqs-visibility-timeout', 'sqs-dlq', 'lambda-concurrency'],
      kind: 'queueBehavior',
      params: { queue: 'sqs:main', consumer: 'lambda:consumer', processingTimeSec: 20, poisonRate: 0.005, arrivals: month, arrivalMinutes: 60, maxAgeSec: 3600, downstreamMaxConcurrency: 100 },
      requirementIds: ['r1', 'r2', 'r3'],
    },
  ],
  concepts: ['sqs-visibility-timeout', 'sqs-dlq', 'lambda-concurrency'],
  reference: mailer({}).done(),
  mistakes: [
    { name: 'Visibility timeout fixed, still no dead-letter queue', board: mailer({}, {}, false).done(), expectFail: ['month-end'] },
    { name: 'DLQ added, visibility timeout still 10 s', board: mailer({ visibilityTimeoutSec: 10 }).done(), expectFail: ['month-end'] },
    { name: 'No concurrency cap on the mailer', board: mailer({}, { reservedConcurrency: null }).done(), expectFail: ['month-end'] },
  ],
  keywords: ['duplicate processing → visibility timeout shorter than processing time', 'poison messages → dead-letter queue (maxReceiveCount)', 'limit downstream concurrency → Lambda reserved concurrency', 'Lambda + SQS: visibility timeout ≥ 6 × function timeout'],
  hints: ['Why would a message be delivered again while it is still being processed?', 'Where do messages go after failing five times?', 'How do you stop Lambda running more than 100 copies?'],
  distractors: ['kinesis', 'cloudfront', 's3'],
  whyNot: { dynamodb: 'An idempotency table is a good extra guard against duplicates, but the root cause here is the visibility timeout.' },
  decisions: [
    {
      title: 'Visibility timeout longer than the work',
      choice: 'invoices hides a received message for 180 s, six times the mailer\'s 30 s timeout.',
      why: 'While a consumer works on a message, SQS hides it for the visibility timeout. If processing takes longer, the message reappears and a second consumer sends it again. AWS recommends at least six times the function timeout for a Lambda event source.',
      events: ['month-end'],
      components: ['invoices'],
      fields: ['visibilityTimeoutSec'],
      manual: ['sqs-visibility-timeout'],
    },
    {
      title: 'A dead-letter queue for bad invoices',
      choice: 'After 5 failed receives a message moves to invoices-dlq, kept 14 days.',
      why: 'A malformed message fails every time. Without a redrive policy it cycles until retention expires, burning concurrency. The DLQ sets it aside for a human, and redrive can move it back once fixed.',
      events: ['month-end'],
      components: ['invoices-dlq', 'invoices'],
      fields: ['dlqId', 'maxReceiveCount', 'retentionSec', 'placement'],
      manual: ['sqs-dlq'],
    },
    {
      title: 'Reserved concurrency matches the provider',
      choice: 'invoice-mailer has reserved concurrency 100.',
      why: 'Lambda scales its SQS pollers up quickly; reserved concurrency caps how many copies run at once, so the email provider never sees more than 100 sends. Messages simply wait in the queue.',
      events: ['month-end'],
      components: ['invoice-mailer'],
      manual: ['lambda-concurrency'],
    },
  ],
});

// =====================================================================================
// 17b. Ride telemetry (finish): shards for throughput, a second consumer, Firehose into S3.
// =====================================================================================

const load = { eventsPerSec: 2000, avgKb: 2 };
const ev = (check: StreamIngestParams['check'], extra: Partial<StreamIngestParams> = {}): StreamIngestParams => ({ check, ...load, ...extra });

function rides(shards: number, opts: { second?: boolean; firehose?: boolean; bufferSec?: number } = {}): BoardBuilder {
  const b = new BoardBuilder(regionOnly(), 'helpful')
    .place('kinesis', 'us-east-1', { name: 'ride-events' })
    .config('ride-events', { mode: 'provisioned', shards, retentionHours: 24 })
    .place('lambda', 'us-east-1', { name: 'surge-pricing' })
    .config('surge-pricing', { eventSourceId: 'ride-events' })
    .place('s3', 'us-east-1', { name: 'ride-lake' });
  if (opts.second) b.place('lambda', 'us-east-1', { name: 'driver-alerts' }).config('driver-alerts', { eventSourceId: 'ride-events' });
  if (opts.firehose) b.place('firehose', 'us-east-1', { name: 'to-lake' }).config('to-lake', { sourceId: 'ride-events', destId: 'ride-lake', format: 'parquet', bufferSec: opts.bufferSec ?? 120, bufferMb: 128 }).place('athena', 'us-east-1', { name: 'ride-queries' }).config('ride-queries', { sourceId: 'ride-lake' });
  return b;
}

export const kinesisLab = lab({
  id: 'c-msg-kinesis',
  course: { section: 17, kind: 'finish', lectures: ['Amazon Kinesis Data Streams', 'Amazon Data Firehose', 'SQS vs SNS vs Kinesis', 'Ordering data into Kinesis'] },
  title: 'Ride telemetry at rush hour',
  client: 'Zippa, an e-scooter hire app',
  users: '2,000 location pings a second at rush hour, 2 KB each',
  brief:
    "Scooters send a ping every few seconds. Surge pricing already reads them from a Kinesis stream, but at rush hour producers get throttled. Now the driver-alerts team needs every ping in real time too, and analytics wants all pings in S3 within five minutes so they can query them with SQL. Pings from one scooter must stay in order.",
  requirements: [
    { id: 'r1', text: 'Ingest 2,000 pings/s (4 MB/s) without throttling' },
    { id: 'r2', text: 'Two real-time consumers both see every ping' },
    { id: 'r3', text: 'Pings queryable with SQL in S3 within 5 minutes' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['kinesis', 'firehose', 'lambda', 's3', 'athena', 'sqs'],
  start: { board: rides(2).done(), fails: ['ingest', 'fanout', 'analytics'] },
  events: [
    { id: 'ingest', name: 'Rush hour', desc: '2,000 pings a second, 2 KB each.', domain: 'performant', concepts: ['kinesis-data-streams'], kind: 'streamIngest', params: ev('ingest'), requirementIds: ['r1'] },
    { id: 'fanout', name: 'Two teams, same pings', desc: 'Surge pricing and driver alerts both read every ping, alongside the delivery to S3.', domain: 'performant', concepts: ['kinesis-data-streams', 'messaging-fanout'], kind: 'streamIngest', params: ev('fanout', { consumers: 2 }), requirementIds: ['r2'] },
    { id: 'analytics', name: 'Analysts at 9 a.m.', desc: 'Pings must be queryable with SQL in S3 within five minutes.', domain: 'performant', concepts: ['kinesis-firehose'], kind: 'streamIngest', params: ev('analytics', { maxDelaySec: 300 }), requirementIds: ['r3'] },
  ],
  concepts: ['kinesis-data-streams', 'kinesis-firehose', 'messaging-fanout'],
  reference: rides(6, { second: true, firehose: true }).done(),
  mistakes: [
    { name: 'Consumers and Firehose added, still 2 shards', board: rides(2, { second: true, firehose: true }).done(), expectFail: ['ingest', 'fanout'] },
    { name: 'Firehose buffering 15 minutes', board: rides(6, { second: true, firehose: true, bufferSec: 900 }).done(), expectFail: ['analytics'] },
  ],
  keywords: ['each shard: 1 MB/s or 1,000 records/s in, 2 MB/s out', 'ProvisionedThroughputExceededException → more shards (or on-demand)', 'ordering per partition key (scooter id)', 'near real-time delivery to S3 → Firehose (buffer interval)'],
  hints: ['How many shards does 4 MB/s in need?', 'Count everything reading the stream', 'Firehose can read from the stream and write to S3'],
  distractors: ['dynamodb', 'apigw', 'route53'],
  whyNot: { sqs: 'An SQS message goes to one consumer and is deleted. Two teams each needing every ping, in order, is a stream.' },
  decisions: [
    {
      title: 'Shards for writes and reads',
      choice: 'ride-events has 6 provisioned shards.',
      why: '4 MB/s in needs at least 4 shards (1 MB/s each). Three readers share each shard\'s 2 MB/s out: 12 MB/s of reads over 2 MB/s per shard needs 6. Enhanced fan-out or on-demand mode are the other answers.',
      events: ['ingest', 'fanout'],
      components: ['ride-events'],
      manual: ['kinesis-data-streams'],
    },
    {
      title: 'A second consumer on the same stream',
      choice: 'driver-alerts reads ride-events with its own event source mapping.',
      why: 'Every consumer of a stream sees every record, in order per shard. That is the difference from a queue.',
      events: ['fanout'],
      components: ['driver-alerts'],
      manual: ['messaging-fanout'],
    },
    {
      title: 'Firehose delivers to the lake, Athena queries it',
      choice: 'to-lake reads ride-events and writes Parquet to ride-lake, buffering 2 minutes; Athena queries the bucket.',
      why: 'Firehose is near real time: it flushes when the buffer fills or the interval passes. A 2-minute interval meets the 5-minute target with no code, and Athena runs SQL straight over the Parquet files.',
      events: ['analytics'],
      components: ['to-lake', 'ride-queries'],
      manual: ['kinesis-firehose'],
    },
  ],
});
