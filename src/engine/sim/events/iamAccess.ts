import type { RequestContext } from '../../iam/types';
import { iamOf, traceCall } from '../../iam/access';
import { failingHop } from '../../net/trace';
import { resolveRef } from '../../select';
import { EventHandler, result } from './context';

export interface IamAccessParams {
  /** "role:<name>" / "user:<name>" for people and roles, or a component ref ("lambda:api", "asg"). */
  principal: string;
  action: string;
  /** Component ref ("s3", "dynamodb"), "key:<alias>" or "role:<name>". */
  resource: string;
  objectKey?: string;
  context?: RequestContext;
  expect: 'allow' | 'deny';
  label?: { principal?: string; resource?: string };
}

export function resolveIamRef(board: Parameters<EventHandler>[0], ref: string): string | null {
  const iam = iamOf(board);
  if (ref.startsWith('role:') || ref.startsWith('user:')) {
    const name = ref.slice(5);
    return Object.values(iam.roles).find((r) => r.name === name)?.id ?? null;
  }
  if (ref.startsWith('key:')) {
    const a = ref.slice(4);
    return Object.values(iam.keys).find((k) => k.alias === a || k.id === a)?.id ?? null;
  }
  return resolveRef(board, ref)?.id ?? null;
}

export const iamAccess: EventHandler = (board, ev) => {
  const p = ev.params as IamAccessParams;
  const principal = resolveIamRef(board, p.principal);
  const resource = resolveIamRef(board, p.resource);
  if (!principal || !resource) {
    const missing = !principal ? p.label?.principal ?? p.principal : p.label?.resource ?? p.resource;
    return result(ev, { status: 'fail', summary: `Nothing to test: ${missing} isn't on the board.`, lesson: 'Place the components this requirement depends on, then run again.', highlight: [] });
  }
  const t = traceCall(board, { principal, action: p.action, resource, objectKey: p.objectKey, context: p.context });
  const bad = failingHop(t);
  const iamHops = t.hops.filter((h) => h.check === 'iam');
  const lastIam = iamHops[iamHops.length - 1];
  const fixTarget = bad?.matched?.objectId ?? bad?.at.id;
  const who = p.label?.principal ?? p.principal;
  if (p.expect === 'deny') {
    if (t.result === 'dropped')
      return result(ev, { status: 'pass', summary: `Denied, as required: ${bad?.explain ?? 'the call was refused.'}`, lesson: 'Least privilege holds for this call.', highlight: [], trace: t });
    return result(ev, {
      status: 'fail',
      summary: `${who} was ALLOWED to call ${p.action}, and must not be. ${lastIam?.explain ?? ''}`,
      lesson: 'An allow is broader than it should be, or a deny guard is missing. Grant only the actions and resources the job needs, and keep explicit Deny guards (such as a VPC endpoint condition) in place.',
      highlight: [resource],
      fixTarget: lastIam?.matched?.objectId ?? resource,
      trace: t,
    });
  }
  if (t.result === 'dropped') {
    const isIam = bad?.check === 'iam';
    return result(ev, {
      status: 'fail',
      summary: isIam ? `AccessDenied: ${bad!.explain}` : `The request never reached the service: ${bad?.explain ?? 'no network path.'}`,
      lesson: isIam
        ? bad?.iam?.reason === 'explicit-deny'
          ? 'An explicit Deny wins over every Allow. Narrow the deny (add a condition for the legitimate caller) rather than adding more allows.'
          : 'Implicit deny: nothing granted this exact action on this exact resource. Check the action name, the resource ARN, any condition, and (for KMS) the key policy.'
        : 'Fix the network path first: permissions only matter once the request arrives.',
      highlight: [principal, resource].filter((x) => board.components[x]),
      fixTarget,
      trace: t,
    });
  }
  return result(ev, { status: 'pass', summary: `Allowed: ${iamHops.map((h) => h.iam?.action).join(' + ')} ${t.via === 'vpce' ? '(through the gateway endpoint)' : ''}`.trim() + '.', lesson: 'Every policy in the chain allowed the call.', highlight: [], trace: t });
};
