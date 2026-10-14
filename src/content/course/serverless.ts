// Section 19 (serverless overview), section 20 (serverless solution architectures) and section 22 (data and analytics).

import { BoardBuilder } from '../../engine/builder';
import { lab, regionOnly, usage0 } from './helpers';

// =====================================================================================
// 19a. The menu API (build): API Gateway, Lambda with a realistic timeout, DynamoDB with point-in-time recovery.
// =====================================================================================

const lunch = [
  { min: 0, rps: 20 },
  { min: 10, rps: 20 },
  { min: 20, rps: 150 },
  { min: 50, rps: 150 },
  { min: 60, rps: 30 },
];

function menu(fn: Record<string, unknown> = {}, table: Record<string, unknown> = {}): BoardBuilder {
  return new BoardBuilder(regionOnly(), 'helpful')
    .place('apigw', '', { name: 'menu-api' })
    .place('lambda', '', { name: 'menu-fn' })
    .place('dynamodb', '', { name: 'menu-items' })
    .config('menu-api', { integration: { kind: 'lambda', targetId: 'menu-fn' } })
    .config('menu-fn', { timeoutSec: 10, ...fn })
    .config('menu-items', { pitr: true, ...table });
}

export const menuApiLab = lab({
  id: 'c-sls-menu',
  course: { section: 19, kind: 'build', lectures: ['AWS Lambda Overview', 'Lambda Limits', 'Amazon DynamoDB', 'DynamoDB - Advanced Features', 'API Gateway - Overview'] },
  title: 'The lunch-rush menu API',
  client: 'Saffron Street, a chain of 40 takeaway kitchens',
  users: 'Ordering kiosks and apps: 20 requests a second, 150 at lunch',
  brief:
    "We want a serverless menu API: no servers to patch, pay per request. Each call checks stock with our point-of-sale system, which is slow: about 4 seconds. Menu items live in a key-value table. Last year someone's bad script overwrote half the prices and we only noticed the next day, so we need to be able to roll the table back.",
  requirements: [
    { id: 'r1', text: 'The API handles the lunch rush (≤ 1% errors, p95 ≤ 6 s)', target: { p95Ms: 6000 } },
    { id: 'r2', text: 'The menu table can be restored to before a bad write found a day later' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['apigw', 'lambda', 'dynamodb', 'sqs', 'rds'],
  events: [
    { id: 'rush', name: 'Lunch rush', desc: 'Requests climb from 20 to 150 a second. Each handler call takes about 4 s because of the POS check.', domain: 'performant', concepts: ['apigw-integrations', 'lambda-concurrency'], kind: 'traffic', params: { entry: 'apigw', profile: lunch, durationMin: 70, slo: { errorRate: 0.01, p95Ms: 6000 }, handlerMs: 4000 }, requirementIds: ['r1'] },
    { id: 'oops', name: 'A script overwrites prices', desc: 'Someone notices bad prices 24 hours later.', domain: 'resilient', concepts: ['dynamodb-capacity'], kind: 'dataLoss', params: { scenario: 'corruption', target: 'dynamodb', discoveredAfterHours: 24, label: 'the menu table' }, requirementIds: ['r2'] },
  ],
  concepts: ['apigw-integrations', 'lambda-concurrency', 'dynamodb-capacity'],
  reference: menu().done(),
  mistakes: [
    { name: 'Lambda timeout left at the default 3 s', board: menu({ timeoutSec: 3 }).done(), expectFail: ['rush'] },
    { name: 'No point-in-time recovery', board: menu({}, { pitr: false }).done(), expectFail: ['oops'] },
  ],
  keywords: ['serverless, no servers to manage → API Gateway + Lambda + DynamoDB', 'Lambda default timeout 3 s, maximum 15 min', 'API Gateway integration timeout 29 s', 'DynamoDB point-in-time recovery: any second in the last 35 days'],
  hints: ['An API in front of a function', 'How long may the function run before Lambda stops it?', 'A table setting that lets you restore to any second'],
  distractors: ['cloudfront', 's3', 'kinesis'],
  whyNot: {
    sqs: 'A queue suits work the caller can wait for. A kiosk needs the menu now, and 4 seconds is well inside API Gateway\'s 29-second limit.',
    rds: 'A relational database would work, but it is a server to size and patch. A key-value menu fits DynamoDB, which scales per request.',
  },
  decisions: [
    {
      title: 'API Gateway in front of Lambda',
      choice: 'menu-api uses a Lambda proxy integration to menu-fn.',
      why: 'API Gateway handles HTTPS, throttling and auth; Lambda runs only when called and scales per request. 150 rps × 4 s needs about 600 concurrent executions, inside the default 1,000 per Region.',
      events: ['rush'],
      components: ['menu-api'],
      manual: ['apigw-integrations'],
    },
    {
      title: 'A timeout that fits the work',
      choice: 'menu-fn has a 10 s timeout.',
      why: 'Lambda stops a function at its timeout: 3 s by default, up to 15 minutes. A 4 s handler with a 3 s timeout fails every call. Behind API Gateway, keep it under the 29 s integration timeout.',
      events: ['rush'],
      components: ['menu-fn'],
      manual: ['lambda-concurrency'],
    },
    {
      title: 'Point-in-time recovery on the table',
      choice: 'menu-items has PITR on.',
      why: 'PITR restores a table to any second in the last 35 days, into a new table. On-demand backups are snapshots you take yourself.',
      events: ['oops'],
      components: ['menu-items'],
      manual: ['dynamodb-capacity'],
    },
  ],
});

// =====================================================================================
// 19b. Throttled by a neighbour (fix): one function's reserved concurrency starves another.
// =====================================================================================

const peak = [
  { min: 0, rps: 50 },
  { min: 10, rps: 50 },
  { min: 15, rps: 300 },
  { min: 45, rps: 300 },
  { min: 50, rps: 50 },
];

function quotes(reportReserved: number | null, apiTimeout = 5): BoardBuilder {
  return new BoardBuilder(regionOnly(), 'helpful')
    .place('apigw', '', { name: 'quote-api' })
    .place('lambda', '', { name: 'quote-fn' })
    .place('lambda', '', { name: 'report-fn' })
    .place('dynamodb', '', { name: 'quotes' })
    .config('quote-api', { integration: { kind: 'lambda', targetId: 'quote-fn' } })
    .config('quote-fn', { timeoutSec: apiTimeout })
    .config('report-fn', { timeoutSec: 900, reservedConcurrency: reportReserved });
}

export const concurrencyLab = lab({
  id: 'c-sls-throttle',
  course: { section: 19, kind: 'fix', lectures: ['Lambda Concurrency and Throttling', 'Lambda Limits', 'Lambda SnapStart', 'Customization At The Edge'] },
  title: 'Throttled by a neighbour',
  client: 'Harbourline Insurance, instant quotes',
  users: '50 quote requests a second, 300 during the evening TV advert',
  brief:
    "Every evening when our advert airs, a third of quote requests fail with 429 Too Many Requests, even though Lambda is supposed to scale. A teammate also lowered the quote function's timeout to 1 second 'to save money', and since then things are worse. A quote takes about 1.5 seconds. The overnight report function runs at 2 a.m. and needs at most 100 concurrent executions.",
  requirements: [
    { id: 'r1', text: 'Quotes succeed during the advert (≤ 1% errors)' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['apigw', 'lambda', 'dynamodb', 'sqs'],
  start: { board: quotes(900, 1).done(), fails: ['advert'] },
  events: [
    { id: 'advert', name: 'The advert airs', desc: 'Quotes jump from 50 to 300 a second for half an hour. Each takes 1.5 s.', domain: 'performant', concepts: ['lambda-concurrency'], kind: 'traffic', params: { entry: 'apigw', profile: peak, durationMin: 60, slo: { errorRate: 0.01, p95Ms: 3000 }, handlerMs: 1500 }, requirementIds: ['r1'] },
  ],
  concepts: ['lambda-concurrency', 'apigw-integrations'],
  reference: quotes(100).done(),
  mistakes: [
    { name: 'Timeout fixed, report still reserves 900', board: quotes(900).done(), expectFail: ['advert'] },
    { name: 'Reservation trimmed, timeout still 1 s', board: quotes(100, 1).done(), expectFail: ['advert'] },
  ],
  keywords: ['account concurrency limit: 1,000 per Region (soft)', 'reserved concurrency removes capacity from the shared pool', 'concurrency = requests per second × duration', 'throttling → 429 TooManyRequests'],
  hints: ['300 requests a second × 1.5 s = how many concurrent executions?', 'Where did the other 900 go?', 'A function cannot finish faster than its handler'],
  distractors: ['s3', 'kinesis', 'cloudfront'],
  whyNot: {
    sqs: 'A queue would turn errors into waiting, but a customer asking for a quote wants the answer now. The capacity is there; it is just reserved for the wrong function.',
    dynamodb: 'The quotes table is not the bottleneck: the errors are Lambda throttles.',
  },
  decisions: [
    {
      title: 'Reserve only what the report needs',
      choice: 'report-fn reserves 100 concurrent executions, not 900.',
      why: 'Reserved concurrency both guarantees and caps a function, and it comes out of the Region\'s shared pool of 1,000. With 900 reserved for a nightly job, every other function shares 100. The advert needs 300 × 1.5 s = 450.',
      events: ['advert'],
      components: ['report-fn'],
      manual: ['lambda-concurrency'],
    },
    {
      title: 'A timeout longer than the work',
      choice: 'quote-fn has a 5 s timeout.',
      why: 'A 1 s timeout kills a 1.5 s handler every time. You pay for the duration actually used, so a longer timeout costs nothing unless the code hangs.',
      events: ['advert'],
      components: ['quote-fn'],
      manual: ['lambda-concurrency'],
    },
  ],
});

// =====================================================================================
// 20a. MyTodoList at scale (finish): DAX for a hot item, global tables come later.
// =====================================================================================

function todos(dax: boolean, fn: Record<string, unknown> = {}): BoardBuilder {
  return new BoardBuilder(regionOnly(), 'helpful')
    .place('apigw', '', { name: 'todo-api' })
    .place('lambda', '', { name: 'todo-fn' })
    .place('dynamodb', '', { name: 'todos' })
    .config('todo-api', { integration: { kind: 'lambda', targetId: 'todo-fn' } })
    .config('todo-fn', { timeoutSec: 10, ...fn })
    .config('todos', { dax, pitr: true });
}

export const todoLab = lab({
  id: 'c-sls-todo',
  course: { section: 20, kind: 'finish', lectures: ['Mobile Application: MyTodoList', 'Serverless Website: MyBlog.com', 'Microservices Architecture', 'Amazon DynamoDB Accelerator (DAX)'] },
  title: 'MyTodoList goes viral',
  client: 'MyTodoList, a shared to-do app',
  users: 'Millions of users; one public "Today\'s challenge" list everyone opens at 9 a.m.',
  brief:
    "Our serverless stack (API Gateway, Lambda, DynamoDB) was perfect until we launched a daily public challenge list. At 9 a.m. everyone reads the same item at once and DynamoDB throttles that partition. Reads must be fast, microseconds if we can, without rewriting the app. Writes stay as they are.",
  requirements: [
    { id: 'r1', text: 'The challenge list survives 20,000 reads/s of one item' },
    { id: 'r2', text: 'Each request still succeeds at 200 rps (≤ 1% errors)' },
  ],
  budget: 0,
  usage: usage0,
  layout: regionOnly(),
  palette: ['apigw', 'lambda', 'dynamodb', 'cloudfront', 'sqs'],
  start: { board: todos(false).done(), fails: ['hot-key'] },
  events: [
    { id: 'hot-key', name: '9 a.m. challenge', desc: 'Every open app reads the same item: 20,000 reads a second, all one partition key.', domain: 'performant', concepts: ['dax', 'dynamodb-capacity'], kind: 'globalLatency', params: { hotKeyReadsPerSec: 20000 }, requirementIds: ['r1'] },
    { id: 'api', name: 'Normal traffic', desc: '200 requests a second through the API, 1.5 s each (the function also calls a recommendations service).', domain: 'performant', concepts: ['apigw-integrations'], kind: 'traffic', params: { entry: 'apigw', profile: [{ min: 0, rps: 200 }, { min: 30, rps: 200 }], durationMin: 30, slo: { errorRate: 0.01, p95Ms: 3000 }, handlerMs: 1500 }, requirementIds: ['r2'] },
  ],
  concepts: ['dax', 'dynamodb-capacity', 'apigw-integrations'],
  reference: todos(true).done(),
  mistakes: [
    { name: 'DAX added, function timeout cut to 1 s', board: todos(true, { timeoutSec: 1 }).done(), expectFail: ['api'] },
    { name: 'DAX added, function capped at 50 concurrent', board: todos(true, { reservedConcurrency: 50 }).done(), expectFail: ['api'] },
  ],
  keywords: ['microsecond reads, DynamoDB, no app rewrite → DAX', 'hot partition / hot key → cache', 'DAX is API-compatible with DynamoDB', 'ElastiCache for aggregation results; DAX for individual items and queries'],
  hints: ['The same item, read thousands of times a second', 'A cache built for DynamoDB', 'It uses the same API, so the app barely changes'],
  distractors: ['kinesis', 's3', 'route53'],
  whyNot: {
    cloudfront: 'Caching API responses at the edge could help, but each user\'s own lists are private and change constantly. DAX caches the hot item right in front of the table, with no changes to caching headers.',
    sqs: 'Reads cannot wait in a queue.',
  },
  decisions: [
    {
      title: 'DAX in front of the table',
      choice: 'todos has a DAX cluster.',
      why: 'DAX is an in-memory cache for DynamoDB with microsecond reads. It speaks the DynamoDB API, so the app switches clients rather than logic. A hot key that throttles one partition becomes a cache hit.',
      events: ['hot-key'],
      components: ['todos'],
      manual: ['dax'],
    },
    {
      title: 'Leave the API and function as they are',
      choice: 'todo-api and todo-fn are unchanged.',
      why: 'The bottleneck is one partition of the table. The serverless front end already scales with the request rate.',
      events: ['api'],
      components: ['todo-fn'],
      manual: ['apigw-integrations'],
    },
  ],
});

// =====================================================================================
// 22a. Queryable clickstream (build): Firehose Direct PUT → S3 as Parquet → Athena.
// =====================================================================================

function lake(format: 'parquet' | 'json' = 'parquet', bufferSec = 120, athena = true): BoardBuilder {
  const b = new BoardBuilder(regionOnly(), 'helpful')
    .place('s3', 'us-east-1', { name: 'events-lake' })
    .place('firehose', 'us-east-1', { name: 'events-delivery' })
    .config('events-delivery', { sourceId: null, destId: 'events-lake', format, bufferSec, bufferMb: format === 'parquet' ? 128 : 5 });
  return athena ? b.place('athena', 'us-east-1', { name: 'events-sql' }).config('events-sql', { sourceId: 'events-lake' }) : b;
}

export const analyticsLab = lab({
  id: 'c-data-lake',
  course: { section: 22, kind: 'build', lectures: ['Amazon Athena', 'Amazon Data Firehose', 'AWS Glue', 'Big Data Ingestion Pipeline'] },
  title: 'SQL over every event',
  client: 'Pocketfit, a fitness app',
  users: '1,000 app events a second; analysts who live in SQL',
  brief:
    "Our analysts want to query every app event with SQL within five minutes of it happening. We don't want servers or a data warehouse to run, and we don't need real-time consumers, just the data in S3. Our last attempt stored raw JSON and the query bill was shocking.",
  requirements: [
    { id: 'r1', text: 'Events queryable with SQL within 5 minutes' },
    { id: 'r2', text: 'Monthly bill under $600', target: { budget: 600 } },
  ],
  budget: 600,
  usage: { ...usage0, s3StorageGb: 2000, s3PutRequests: 500_000, s3GetRequests: 2_000_000, streamEventsPerSec: 1000, streamAvgKb: 1, athenaJsonTbScanned: 50 },
  layout: regionOnly(),
  palette: ['firehose', 's3', 'athena', 'kinesis', 'lambda'],
  events: [
    { id: 'analytics', name: 'Analysts at 9 a.m.', desc: 'Every event must be queryable in S3 with SQL within five minutes.', domain: 'performant', concepts: ['kinesis-firehose', 'athena-glue'], kind: 'streamIngest', params: { check: 'analytics', eventsPerSec: 1000, avgKb: 1, maxDelaySec: 300 }, requirementIds: ['r1'] },
    { id: 'bill', name: 'Monthly bill', desc: 'Firehose ingestion and conversion, S3 storage and Athena scans.', domain: 'cost', concepts: ['athena-glue', 'kinesis-firehose'], kind: 'bill', params: {}, requirementIds: ['r2'], passesOnEmptyBoard: true },
  ],
  concepts: ['kinesis-firehose', 'athena-glue', 'kinesis-data-streams'],
  reference: lake().done(),
  mistakes: [
    { name: 'Raw JSON in the lake', board: lake('json').done(), expectFail: ['bill'] },
    { name: 'Firehose buffering 15 minutes', board: lake('parquet', 900).done(), expectFail: ['analytics'] },
    { name: 'Data in S3, nothing to query it', board: lake('parquet', 120, false).done(), expectFail: ['analytics'] },
  ],
  keywords: ['serverless SQL on S3 → Athena', 'load streaming data into S3 with no code → Firehose', 'cheaper, faster Athena → columnar formats (Parquet/ORC), compression, partitions', 'Glue Data Catalog holds the table schema'],
  hints: ['Something that collects events and writes them to S3 in batches', 'A columnar format makes queries scan less', 'A serverless SQL engine over the bucket'],
  distractors: ['dynamodb', 'sqs', 'apigw'],
  whyNot: {
    kinesis: 'A data stream is for real-time consumers and replay. Nobody here reads in real time, so producers can put records straight into Firehose.',
    lambda: 'No custom code is needed: Firehose converts to Parquet itself using the Glue schema.',
  },
  decisions: [
    {
      title: 'Firehose Direct PUT, converting to Parquet',
      choice: 'events-delivery takes records straight from the app and writes Parquet to events-lake every 2 minutes.',
      why: 'Firehose is fully managed and near real time (it flushes on buffer size or interval). Converting to Parquet means Athena reads only the columns a query names, so scans, and the bill, shrink by an order of magnitude.',
      events: ['analytics', 'bill'],
      components: ['events-delivery'],
      manual: ['kinesis-firehose'],
    },
    {
      title: 'Athena over the bucket',
      choice: 'events-sql queries events-lake through the Glue Data Catalog.',
      why: 'Athena is serverless Presto/Trino: no cluster, pay per TB scanned. Redshift would be a warehouse to size and run.',
      events: ['analytics'],
      components: ['events-sql', 'events-lake'],
      manual: ['athena-glue'],
    },
  ],
});
