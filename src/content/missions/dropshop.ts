import type { Mission, VpcLayout } from '../../engine/model';
import { BoardBuilder } from '../../engine/builder';

const layout: VpcLayout = { regionId: 'us-east-1', regionName: 'US East (N. Virginia)' };

const saleProfile = [
  { min: 0, rps: 2 },
  { min: 5, rps: 2 },
  { min: 8, rps: 25 },
  { min: 25, rps: 25 },
  { min: 35, rps: 4 },
  { min: 40, rps: 2 },
];

function reference(): BoardBuilder {
  return new BoardBuilder(layout, 'helpful')
    .place('apigw', '', { name: 'orders-api' })
    .place('sqs', '', { name: 'orders' })
    .place('sqs', '', { name: 'orders-dlq' })
    .place('lambda', '', { name: 'order-worker' })
    .place('dynamodb', '', { name: 'orders-table' })
    .config('orders', { visibilityTimeoutSec: 360, dlqId: 'orders-dlq', maxReceiveCount: 5 })
    .config('orders-dlq', { retentionSec: 1209600 })
    .config('order-worker', { eventSourceId: 'orders', timeoutSec: 60, reservedConcurrency: 300, memoryMb: 512 })
    .config('orders-api', { integration: { kind: 'sqs', targetId: 'orders' } });
}

export const dropshop: Mission = {
  id: 'dropshop',
  stage: 1,
  mode: 'build',
  title: 'The flash sale',
  client: 'Dropshop, limited-edition sneaker drops',
  users: '50,000 people hit "Buy" in the same 20 minutes',
  brief:
    "Our drops sell out in minutes. Last time the checkout API fell over, and the orders that did get through were charged twice. Each order takes about 45 seconds because the payment provider is slow, and they'll rate-limit us if we make more than 300 calls at once. Some orders always have bad card data and fail forever. Every good order must be charged exactly once, within two hours of the drop.",
  requirements: [
    { id: 'r1', text: 'The checkout API accepts every order during the drop (≤ 0.1% errors)' },
    { id: 'r2', text: 'Each order is charged exactly once (no duplicates)' },
    { id: 'r3', text: 'Bad orders are set aside instead of retrying forever' },
    { id: 'r4', text: 'Never more than 300 concurrent calls to the payment provider' },
    { id: 'r5', text: 'Every good order processed within 2 hours' },
    { id: 'r6', text: 'Order data encrypted at rest' },
    { id: 'r7', text: 'Stay under $250/month', target: { budget: 250 } },
  ],
  budget: 250,
  usage: {
    requestsPerMonth: 2_000_000,
    dataOutGb: 5,
    s3StorageGb: 0,
    s3GetRequests: 0,
    s3PutRequests: 0,
    flows: [],
    lambdaGbSeconds: 6_750_000,
    sqsRequests: 6_000_000,
    dynamoWrites: 600_000,
    dynamoReads: 2_000_000,
    dynamoStorageGb: 5,
  },
  defaults: 'helpful',
  layout,
  palette: ['apigw', 'lambda', 'sqs', 'dynamodb'],
  events: [
    {
      id: 'drop',
      name: 'The drop',
      desc: 'Orders jump from 2/s to 25/s for 17 minutes. Each one takes 45 s to charge.',
      domain: 'resilient',
      concepts: ['apigw-integrations', 'lambda-concurrency'],
      kind: 'traffic',
      params: { entry: 'apigw', profile: saleProfile, durationMin: 40, slo: { errorRate: 0.001, p95Ms: 3000 }, handlerMs: 45000 },
      requirementIds: ['r1'],
    },
    {
      id: 'queue',
      name: 'Order processing',
      desc: '45 s per order, 0.2% poison messages, payment provider capped at 300 concurrent calls.',
      domain: 'resilient',
      concepts: ['sqs-visibility-timeout', 'sqs-dlq', 'lambda-concurrency'],
      kind: 'queueBehavior',
      params: { queue: 'sqs:main', consumer: 'lambda:consumer', processingTimeSec: 45, poisonRate: 0.002, arrivals: saleProfile, arrivalMinutes: 40, maxAgeSec: 7200, downstreamMaxConcurrency: 300 },
      requirementIds: ['r2', 'r3', 'r4', 'r5'],
    },
    { id: 'audit', name: 'Security audit', desc: 'Order and payment data must be encrypted at rest.', domain: 'secure', concepts: ['encryption-at-rest'], kind: 'audit', params: { rules: ['encryptionAtRest'] }, requirementIds: ['r6'] },
    { id: 'bill', name: 'Monthly bill', desc: 'Two drops a month: 2M API calls, 6.75M GB-seconds of Lambda.', domain: 'cost', concepts: ['lambda-concurrency', 'dynamodb-capacity'], kind: 'bill', params: {}, requirementIds: ['r7'], passesOnEmptyBoard: true },
  ],
  questions: ['q-ds-1', 'q-ds-2', 'q-ds-3', 'q-ds-4', 'q-ds-5'],
  concepts: ['apigw-integrations', 'lambda-concurrency', 'sqs-visibility-timeout', 'sqs-dlq', 'dynamodb-capacity', 'encryption-at-rest'],
  reference: reference().done(),
  mistakes: [
    { name: 'Visibility timeout (30 s) shorter than processing (45 s)', board: reference().config('orders', { visibilityTimeoutSec: 30 }).done(), expectFail: ['queue'] },
    { name: 'No dead-letter queue', board: reference().config('orders', { dlqId: null }).remove('orders-dlq').done(), expectFail: ['queue'] },
    {
      name: 'Synchronous Lambda behind the API (no queue)',
      board: new BoardBuilder(layout, 'helpful')
        .place('apigw', '', { name: 'orders-api' })
        .place('lambda', '', { name: 'checkout-fn' })
        .place('dynamodb', '', { name: 'orders-table' })
        .config('checkout-fn', { timeoutSec: 60 })
        .config('orders-api', { integration: { kind: 'lambda', targetId: 'checkout-fn' } })
        .done(),
      expectFail: ['drop', 'queue'],
    },
    { name: 'Unreserved consumer concurrency', board: reference().config('order-worker', { reservedConcurrency: null }).done(), expectFail: ['queue'] },
    { name: 'Lambda timeout left at 3 s', board: reference().config('order-worker', { timeoutSec: 3 }).done(), expectFail: ['queue'] },
    { name: 'Reserved concurrency too low (50)', board: reference().config('order-worker', { reservedConcurrency: 50 }).done(), expectFail: ['queue'] },
  ],
  keywords: ['decouple', 'spiky traffic', 'exactly once / duplicate processing → visibility timeout + idempotency', 'poison messages → DLQ', 'throttle downstream → reserved concurrency', 'serverless / least operational overhead'],
  hints: ['An API that accepts orders fast', 'A queue to absorb the spike', 'A dead-letter queue for bad orders', 'A worker function with a concurrency cap', 'A table for orders'],
};
