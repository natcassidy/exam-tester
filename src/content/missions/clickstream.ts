import type { Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';
import type { StreamIngestParams } from '../../engine/sim/events/streamIngest';

const layout: VpcLayout = { regionId: 'us-east-1', regionName: 'US East (N. Virginia)' };

function lake(b: BoardBuilder): BoardBuilder {
  return b.place('s3', 'us-east-1', { name: 'click-lake' }).place('athena', 'us-east-1', { name: 'click-queries' }).config('click-queries', { sourceId: 'click-lake' });
}

function streamed(shards: number, efo = false): BoardBuilder {
  const b = lake(new BoardBuilder(layout, 'helpful'))
    .place('kinesis', 'us-east-1', { name: 'clicks' })
    .config('clicks', { mode: 'provisioned', shards, retentionHours: 24 });
  for (const fn of ['fraud-check', 'recommendations']) b.place('lambda', 'us-east-1', { name: fn }).config(fn, { eventSourceId: 'clicks', enhancedFanOut: efo });
  return b.place('firehose', 'us-east-1', { name: 'to-lake' }).config('to-lake', { sourceId: 'clicks', destId: 'click-lake', format: 'parquet', bufferSec: 120, bufferMb: 128 });
}

const reference = () => streamed(15);

const load = { eventsPerSec: 5000, avgKb: 2 };
const ev = (check: StreamIngestParams['check'], extra: Partial<StreamIngestParams> = {}): StreamIngestParams => ({ check, ...load, ...extra });

export const clickstream: Mission = {
  id: 'clickstream',
  stage: 3,
  mode: 'build',
  title: 'Every click, twice',
  client: 'Larder, an online grocery marketplace',
  users: '5,000 click events a second at peak, 2 KB each',
  brief:
    "We want to react to clicks while the shopper is still on the page: one team scores each session for fraud, another updates recommendations, and both need every click in order per session. When a consumer ships a bug, they need to rewind and replay the last day. Analysts also want every click in S3 within five minutes so they can query it with SQL, and our last attempt cost a fortune in query fees. Keep the whole pipeline under $3,500 a month.",
  requirements: [
    { id: 'r1', text: 'Ingest 5,000 events/s (10 MB/s) without throttling' },
    { id: 'r2', text: 'Each session’s clicks arrive in order' },
    { id: 'r3', text: 'Two independent real-time consumers both see every click' },
    { id: 'r4', text: 'Replay the last 24 hours' },
    { id: 'r5', text: 'Clicks queryable with SQL in S3 within 5 minutes' },
    { id: 'r6', text: 'Monthly bill under $3,500', target: { budget: 3500 } },
  ],
  budget: 3500,
  usage: { requestsPerMonth: 0, dataOutGb: 0, s3StorageGb: 4000, s3GetRequests: 5_000_000, s3PutRequests: 1_000_000, flows: [], lambdaGbSeconds: 2_000_000, streamEventsPerSec: 5000, streamAvgKb: 2, athenaJsonTbScanned: 300 },
  defaults: 'helpful',
  layout,
  palette: ['kinesis', 'firehose', 'lambda', 'sqs', 's3', 'athena'],
  events: [
    { id: 'ingest', name: 'Saturday peak', desc: '5,000 click events a second, 2 KB each, from the web and mobile apps.', domain: 'performant', concepts: ['kinesis-data-streams'], kind: 'streamIngest', params: ev('ingest'), requirementIds: ['r1'] },
    { id: 'ordering', name: 'Session replay looks wrong', desc: 'Fraud scoring depends on the order of a shopper’s clicks.', domain: 'resilient', concepts: ['kinesis-data-streams', 'messaging-fanout'], kind: 'streamIngest', params: ev('ordering'), requirementIds: ['r2'] },
    { id: 'fanout', name: 'Two teams, same clicks', desc: 'Fraud and recommendations both read every event in real time, alongside the delivery to S3.', domain: 'performant', concepts: ['kinesis-data-streams', 'messaging-fanout'], kind: 'streamIngest', params: ev('fanout', { consumers: 2 }), requirementIds: ['r3'] },
    { id: 'replay', name: 'Bad deploy', desc: 'Recommendations shipped a bug overnight and needs to reprocess the last 24 hours.', domain: 'resilient', concepts: ['kinesis-data-streams'], kind: 'streamIngest', params: ev('replay', { replayHours: 24 }), requirementIds: ['r4'] },
    { id: 'analytics', name: 'Analysts at 9 am', desc: 'Clicks must be queryable in S3 with SQL within five minutes.', domain: 'performant', concepts: ['kinesis-firehose', 'athena-glue'], kind: 'streamIngest', params: ev('analytics', { maxDelaySec: 300 }), requirementIds: ['r5'] },
    { id: 'bill', name: 'Monthly bill', desc: 'Shards, PUT units, Firehose ingestion and conversion, and Athena scans.', domain: 'cost', concepts: ['kinesis-data-streams', 'athena-glue', 'kinesis-firehose'], kind: 'bill', params: {}, requirementIds: ['r6'], passesOnEmptyBoard: true },
  ],
  questions: ['q-cs-1', 'q-cs-2', 'q-cs-3', 'q-cs-4', 'q-cs-5'],
  concepts: ['kinesis-data-streams', 'kinesis-firehose', 'athena-glue', 'messaging-fanout'],
  reference: reference().done(),
  mistakes: [
    { name: 'Five shards', board: streamed(5).done(), expectFail: ['ingest', 'fanout'] },
    { name: 'Ten shards, no enhanced fan-out', board: streamed(10).done(), expectFail: ['fanout'] },
    {
      name: 'SQS Standard queue instead of a stream',
      board: lake(new BoardBuilder(layout, 'helpful'))
        .place('sqs', 'us-east-1', { name: 'clicks' })
        .place('lambda', 'us-east-1', { name: 'fraud-check' })
        .config('fraud-check', { eventSourceId: 'clicks' })
        .place('lambda', 'us-east-1', { name: 'recommendations' })
        .config('recommendations', { eventSourceId: 'clicks' })
        .place('firehose', 'us-east-1', { name: 'to-lake' })
        .config('to-lake', { destId: 'click-lake', format: 'parquet', bufferSec: 120, bufferMb: 128 })
        .done(),
      expectFail: ['ordering', 'fanout', 'replay'],
    },
    { name: 'JSON in the lake (no Parquet conversion)', board: reference().config('to-lake', { format: 'json', bufferMb: 5 }).done(), expectFail: ['bill'] },
    { name: 'Firehose buffer of 15 minutes', board: reference().config('to-lake', { bufferSec: 900 }).done(), expectFail: ['analytics'] },
  ],
  keywords: ['real-time, multiple consumers, ordering, replay → Kinesis Data Streams', 'load into S3 / Redshift with no code → Firehose', 'query S3 with SQL → Athena', 'reduce Athena cost → Parquet, partitioning', 'ProvisionedThroughputExceededException'],
  hints: ['A Kinesis data stream sized for 10 MB/s and the read side', 'One Lambda consumer per team', 'Firehose from the stream into S3 as Parquet', 'Athena on the bucket'],
};
