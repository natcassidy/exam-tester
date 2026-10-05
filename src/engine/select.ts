import type { Board, Component, Endpoint } from './model';

/**
 * Missions refer to components by role, not id, because the learner places them.
 * A ref is a component id, a service type ("alb"), or a type with a role:
 *   "sqs:main"        a queue that is not another queue's dead-letter queue
 *   "lambda:consumer" a function with an SQS event source
 *   "lambda:api"      a function without one
 */
export function resolveRef(board: Board, ref: string): Component | undefined {
  if (board.components[ref]) return board.components[ref];
  const [type, role] = ref.split(':');
  const all = Object.values(board.components).filter((c) => c.type === type);
  if (!role) return all[0];
  if (type === 'sqs' && role === 'main') {
    const dlqs = new Set(Object.values(board.components).map((c) => (c.config.type === 'sqs' ? c.config.dlqId : null)).filter(Boolean));
    return all.find((c) => !dlqs.has(c.id));
  }
  if (type === 'sqs' && role === 'dlq') {
    const main = resolveRef(board, 'sqs:main');
    return main && main.config.type === 'sqs' && main.config.dlqId ? board.components[main.config.dlqId] : undefined;
  }
  if (type === 'lambda' && role === 'consumer') return all.find((c) => c.config.type === 'lambda' && c.config.eventSourceId);
  if (type === 'lambda' && role === 'api') return all.find((c) => c.config.type === 'lambda' && !c.config.eventSourceId);
  return undefined;
}

export function resolveEndpoint(board: Board, ref: string): Endpoint | null {
  if (ref === 'internet' || ref === 'svc:s3' || ref === 'svc:dynamodb') return ref;
  return resolveRef(board, ref)?.id ?? null;
}
