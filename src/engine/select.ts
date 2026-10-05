import type { Board, Component, Endpoint } from './model';
import { regionOf, vpcOfComponent } from './board';

/**
 * Missions refer to components by role, not id, because the learner places them.
 * A ref is a component id, a service type ("alb"), or a type with a role:
 *   "sqs:main"        a queue that is not another queue's dead-letter queue
 *   "lambda:consumer" a function with an SQS event source
 *   "lambda:api"      a function without one
 * A "@region" suffix restricts the match to one Region ("alb@us-west-2"). A name in quotes
 * matches by component name ('"payroll-db"'), and "type#vpc-id" matches by VPC ("ec2#vpc-prod").
 */
export function resolveRef(board: Board, ref0: string): Component | undefined {
  if (board.components[ref0]) return board.components[ref0];
  if (ref0.startsWith('"')) return Object.values(board.components).find((c) => c.name === ref0.slice(1, -1));
  if (ref0.includes('#')) {
    const [type, vpcId] = ref0.split('#');
    return Object.values(board.components).find((c) => c.type === type && vpcOfComponent(board, c)?.id === vpcId);
  }
  const [ref, region] = ref0.split('@');
  const [type, role] = ref.split(':');
  const all = Object.values(board.components).filter((c) => c.type === type && (!region || regionOf(board, c) === region));
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
  if (ref === 'internet' || ref === 'svc:s3' || ref === 'svc:dynamodb' || ref === 'onprem') return ref;
  return resolveRef(board, ref)?.id ?? null;
}
