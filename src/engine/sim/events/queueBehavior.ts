import type { ConfigOf, TimelinePoint } from '../../model';
import { resolveRef } from '../../select';
import { demandAt, lambdaLimit, ProfilePoint } from '../capacity';
import { EventHandler, fmtSec, result } from './context';

export interface QueueParams {
  queue: string; // ref, usually 'sqs:main'
  consumer: string; // ref, usually 'lambda:consumer'
  processingTimeSec: number;
  /** Fraction of messages that can never succeed (poison). */
  poisonRate: number;
  /** Messages per second arriving over time. */
  arrivals: ProfilePoint[];
  arrivalMinutes: number;
  /** Every message must be processed within this many seconds of arriving. */
  maxAgeSec: number;
  /** Downstream dependency limit (e.g. payment provider concurrent calls). */
  downstreamMaxConcurrency?: number;
}

/** Lambda's SQS poller adds up to 300 concurrent executions per minute; standard queues cap at 1,250. */
export const SQS_LAMBDA_SCALE_PER_MIN = 300;
export const SQS_LAMBDA_MAX_CONCURRENCY = 1250;
export const FIFO_MAX_TPS = 3000; // with batching; 300 without

export const queueBehavior: EventHandler = (board, ev) => {
  const p = ev.params as QueueParams;
  const q = resolveRef(board, p.queue);
  const fn = resolveRef(board, p.consumer);
  if (!q) return result(ev, { status: 'fail', incomplete: true, summary: 'No queue on the board.', lesson: 'Place an SQS queue between the producer and the worker.', highlight: [] });
  if (!fn) return result(ev, { status: 'fail', summary: `Nothing consumes ${q.name}: no Lambda function has it as an event source.`, lesson: 'Set the queue as the worker function\'s event source.', highlight: [q.id], fixTarget: q.id });
  const qc = q.config as ConfigOf<'sqs'>;
  const fc = fn.config as ConfigOf<'lambda'>;
  if (fc.eventSourceId !== q.id) return result(ev, { status: 'fail', summary: `${fn.name} consumes a different queue.`, lesson: '', highlight: [fn.id], fixTarget: fn.id });

  const lines: { label: string; value: string; status?: 'pass' | 'warn' | 'fail' }[] = [];
  const problems: { text: string; lesson: string; target: string; concept: string }[] = [];
  let warn: string | null = null;

  const timesOut = fc.timeoutSec < p.processingTimeSec;
  if (timesOut) problems.push({ text: `${fn.name} times out after ${fc.timeoutSec}s but each order takes ${p.processingTimeSec}s, so every invocation fails and the message comes back.`, lesson: 'Set the function timeout above the real processing time.', target: fn.id, concept: 'lambda-concurrency' });
  const dupFactor = qc.visibilityTimeoutSec >= p.processingTimeSec ? 1 : Math.ceil(p.processingTimeSec / Math.max(1, qc.visibilityTimeoutSec));

  const limit = Math.min(lambdaLimit(board, fn), SQS_LAMBDA_MAX_CONCURRENCY);
  const downstreamOver = p.downstreamMaxConcurrency !== undefined && limit > p.downstreamMaxConcurrency;

  // Minute-by-minute queue model.
  const points: TimelinePoint[] = [];
  let conc = 0;
  let arrivedTotal = 0;
  let processedTotal = 0;
  let duplicates = 0;
  const arrivedCum: number[] = [];
  let maxAgeMin = 0;
  let m = 0;
  const horizon = 24 * 60;
  const total = (() => {
    let t = 0;
    for (let i = 0; i < p.arrivalMinutes; i++) t += demandAt(p.arrivals, i) * 60;
    return t;
  })();
  const good = total * (1 - p.poisonRate);
  for (; m < horizon; m++) {
    const a = m < p.arrivalMinutes ? demandAt(p.arrivals, m) * 60 : 0;
    arrivedTotal += a;
    arrivedCum.push(arrivedTotal);
    const backlog = arrivedTotal * (1 - p.poisonRate) - processedTotal;
    const want = backlog > 0 ? limit : 0;
    conc = Math.min(want, conc + SQS_LAMBDA_SCALE_PER_MIN);
    // Each execution handles one message per processingTime; duplicates waste capacity.
    const capacity = timesOut ? 0 : (conc * 60) / p.processingTimeSec / dupFactor;
    const done = Math.max(0, Math.min(backlog, capacity));
    processedTotal += done;
    duplicates += done * (dupFactor - 1);
    // Age of the oldest unprocessed good message.
    let t = 0;
    while (t < arrivedCum.length && arrivedCum[t] * (1 - p.poisonRate) <= processedTotal + 1e-6) t++;
    const age = t < arrivedCum.length && processedTotal < arrivedTotal * (1 - p.poisonRate) - 1e-6 ? m - t : 0;
    maxAgeMin = Math.max(maxAgeMin, age);
    if (m < 240 || m % 10 === 0) points.push({ min: m, demand: Math.round(a / 60), capacity: Math.round(capacity / 60), errors: 0, p95: 0, depth: Math.round(Math.max(0, backlog - done)) });
    if (m >= p.arrivalMinutes && processedTotal >= good - 1e-6) break;
  }
  const drained = processedTotal >= good - 1e-6;
  const maxAgeSec = drained ? maxAgeMin * 60 : Infinity;

  lines.push({ label: 'Orders', value: `${Math.round(total).toLocaleString()} arrived, ${Math.round(processedTotal).toLocaleString()} processed` });
  lines.push({ label: 'Consumer concurrency', value: `${limit} (${fc.reservedConcurrency === null ? 'unreserved: shares the 1,000 account pool' : 'reserved'})` });

  if (dupFactor > 1) problems.push({ text: `Visibility timeout ${qc.visibilityTimeoutSec}s is shorter than the ${p.processingTimeSec}s processing time. Each message becomes visible again mid-processing and another worker picks it up: ${Math.round(duplicates).toLocaleString()} duplicate charges.`, lesson: 'Set the visibility timeout longer than the processing time (AWS recommends 6× the function timeout for Lambda event sources) and make the handler idempotent.', target: q.id, concept: 'sqs-visibility-timeout' });
  lines.push({ label: 'Duplicates', value: Math.round(duplicates).toLocaleString(), status: dupFactor > 1 ? 'fail' : 'pass' });

  const poison = total * p.poisonRate;
  if (poison > 0) {
    if (!qc.dlqId) {
      const receives = Math.round(poison * ((qc.retentionSec / Math.max(1, qc.visibilityTimeoutSec)) | 0));
      problems.push({ text: `${Math.round(poison)} poison messages fail every time. With no dead-letter queue they return after every visibility timeout until retention expires (${fmtSec(qc.retentionSec)}): ~${receives.toLocaleString()} wasted receives, and nobody is alerted.`, lesson: 'Configure a redrive policy: a DLQ with a small maxReceiveCount (3-5), and alarm on its depth.', target: q.id, concept: 'sqs-dlq' });
      lines.push({ label: 'Poison messages', value: `${Math.round(poison)} looping forever`, status: 'fail' });
    } else {
      const dlq = board.components[qc.dlqId];
      lines.push({ label: 'Poison messages', value: `${Math.round(poison)} moved to ${dlq?.name} after ${qc.maxReceiveCount} receives`, status: 'pass' });
      if (qc.maxReceiveCount > 10) warn = `maxReceiveCount ${qc.maxReceiveCount} keeps poison messages cycling for a long time; 3-5 is typical.`;
    }
  }

  if (downstreamOver) problems.push({ text: `${fn.name} can run ${limit} copies at once, but the payment provider allows ${p.downstreamMaxConcurrency} concurrent calls. The surge hammers it into rate-limiting every order.`, lesson: `Set reserved concurrency on the consumer to cap it at the downstream limit (${p.downstreamMaxConcurrency}). Reserved concurrency is both a guarantee and a ceiling.`, target: fn.id, concept: 'lambda-concurrency' });
  lines.push({ label: 'Downstream calls', value: p.downstreamMaxConcurrency !== undefined ? `${limit} concurrent (provider limit ${p.downstreamMaxConcurrency})` : `${limit} concurrent`, status: downstreamOver ? 'fail' : 'pass' });

  const ageOk = maxAgeSec <= p.maxAgeSec;
  const lost = maxAgeSec > qc.retentionSec;
  if (!ageOk && !timesOut) problems.push({ text: `The oldest order waited ${fmtSec(maxAgeSec)} (requirement ≤ ${fmtSec(p.maxAgeSec)}). Throughput is concurrency × 60 / ${p.processingTimeSec}s = ${Math.round((limit * 60) / p.processingTimeSec)} orders/min.`, lesson: 'Raise the consumer\'s concurrency (as far as the downstream allows) to drain faster.', target: fn.id, concept: 'lambda-concurrency' });
  if (lost) problems.push({ text: `Messages outlived the ${fmtSec(qc.retentionSec)} retention period and were deleted.`, lesson: 'Retention is 4 days by default (max 14). Drain faster or extend retention.', target: q.id, concept: 'sqs-visibility-timeout' });
  lines.push({ label: 'Oldest message age', value: `${fmtSec(maxAgeSec)} (requirement ≤ ${fmtSec(p.maxAgeSec)})`, status: ageOk ? 'pass' : 'fail' });

  if (qc.fifo) {
    const peak = Math.max(...p.arrivals.map((x) => x.rps));
    if (peak > FIFO_MAX_TPS) problems.push({ text: `FIFO queues handle about ${FIFO_MAX_TPS} messages/s with batching (300 without). Peak arrivals are ${peak}/s.`, lesson: 'Use a Standard queue with idempotent consumers, or high-throughput FIFO with many message group IDs.', target: q.id, concept: 'sqs-visibility-timeout' });
  }
  if (!problems.length && qc.visibilityTimeoutSec < 6 * fc.timeoutSec) warn ??= `Visibility timeout ${qc.visibilityTimeoutSec}s is below 6× the function timeout (${6 * fc.timeoutSec}s), AWS's recommendation for Lambda event sources so retries and batching don't cause early redelivery.`;

  if (problems.length) {
    return result(ev, {
      status: 'fail',
      summary: problems[0].text,
      detail: { lines },
      lesson: problems.map((x) => x.lesson).join(' '),
      manual: [...new Set([...problems.map((x) => x.concept), ...ev.concepts])],
      highlight: [...new Set(problems.map((x) => x.target))],
      fixTarget: problems[0].target,
      timeline: { points },
      metrics: { duplicates, maxAgeSec },
    });
  }
  return result(ev, {
    status: warn ? 'warn' : 'pass',
    summary: `Every order processed exactly once; oldest waited ${fmtSec(maxAgeSec)}.${warn ? ' ' + warn : ''}`,
    detail: { lines },
    lesson: warn ?? 'Visibility timeout covers processing, poison messages go to the DLQ, and concurrency respects the downstream limit.',
    highlight: [],
    timeline: { points },
    metrics: { duplicates, maxAgeSec },
  });
};
