// "Fix it" pointers for a packet trace: the object that stopped the packet, and what to change there.

import type { Board, FixPointer, Hop } from '../model';
import { allSubnets } from './routing';

const nameOf = (board: Board, id: string): string =>
  board.securityGroups[id]?.name ?? board.nacls[id]?.name ?? board.routeTables[id]?.name ?? board.components[id]?.name ?? board.iam?.roles[id]?.name ?? id;

/** What to change so the denied hop allows the flow. */
export function fixFromHop(board: Board, hop: Hop | undefined): FixPointer | undefined {
  if (!hop || hop.result !== 'deny') return undefined;
  const fix = pointer(board, hop);
  // The internet, the data centre and AWS services have no console to open: keep the hint, drop the target.
  if (fix.target && !openable(board, fix.target)) delete fix.target;
  return fix;
}

function openable(board: Board, id: string): boolean {
  return !!(board.components[id] || board.securityGroups[id] || board.nacls[id] || board.routeTables[id] || board.iam?.roles[id] || board.iam?.keys[id] || allSubnets(board).some((s) => s.id === id));
}

function pointer(board: Board, hop: Hop): FixPointer {
  const target = hop.matched?.objectId ?? hop.at.id;
  const ruleRef = hop.matched?.ruleRef;
  const name = nameOf(board, target);
  switch (hop.check) {
    case 'sg-in':
      return {
        target,
        ruleRef,
        hint: board.securityGroups[target]
          ? `Add an inbound rule to ${name} for this port. When the traffic comes from another tier, choose source type "Security group" and pick that tier's group instead of an address range.`
          : `${name} has no security group: attach one on its Networking tab that allows this traffic in.`,
        focus: board.securityGroups[target] ? undefined : { tab: 'networking', label: 'Security groups attached' },
      };
    case 'sg-out':
      return {
        target,
        ruleRef,
        hint: board.securityGroups[target]
          ? `Add an outbound rule to ${name} for this port and destination (the default "all outbound" rule is missing or was removed).`
          : `${name} has no security group: attach one on its Networking tab.`,
        focus: board.securityGroups[target] ? undefined : { tab: 'networking', label: 'Security groups attached' },
      };
    case 'nacl-in':
    case 'nacl-out': {
      const dir = hop.check === 'nacl-in' ? 'inbound' : 'outbound';
      const implicit = ruleRef?.endsWith('*');
      const ret = /return traffic|ephemeral/.test(hop.explain);
      return {
        target,
        ruleRef,
        hint: implicit
          ? `Add an ${dir} allow rule to ${name} for ${ret ? 'the ephemeral return ports 1024-65535' : 'this port'}. NACLs are stateless: each direction needs its own rule.`
          : `${ruleRef ? `${ruleRef[0].toUpperCase()}${ruleRef.slice(1)}` : 'A rule'} in ${name} denies this traffic. Delete it, or add an allow rule with a lower number (lowest number wins).`,
      };
    }
    case 'route':
      if (board.routeTables[target])
        return {
          target,
          ruleRef,
          hint: `In ${name}, add or correct the route for this destination. Private subnets reach the internet with 0.0.0.0/0 → a NAT gateway in the same AZ; public subnets use the internet gateway; other networks need a peering, transit gateway or VPN route.`,
        };
      return { target, hint: hop.explain };
    case 'public-ip':
      return {
        target,
        hint: `${name} has no public IP, so the internet gateway can't translate for it. Keep it private and send its subnet's 0.0.0.0/0 route to a NAT gateway instead.`,
      };
    case 'nat':
      return {
        target,
        hint: 'A NAT gateway must sit in a public subnet, and each AZ needs its own: point every private route table at the NAT gateway in its own AZ.',
      };
    case 'lb-listener':
      return { target, hint: `Check ${name}'s listener protocol and port match what clients use.`, focus: { tab: 'config', label: 'Listener' } };
    case 'lb-target-health':
      return { target, hint: `${name} has no healthy targets. Check its target group, the health check path and port, and that the targets' security group allows the load balancer in.`, focus: { tab: 'config', label: 'Target group' } };
    case 'iam': {
      const action = hop.iam?.action ?? 'this action';
      const comp = board.components[target];
      const label = board.iam?.keys[target] ? 'Key policy' : comp?.type === 's3' ? 'Bucket policy' : comp?.type === 'sqs' ? 'Queue policy' : comp?.type === 'vpce' ? 'Endpoint policy' : 'Permission policies';
      const focus = { tab: 'permissions' as const, label };
      if (hop.iam?.reason === 'explicit-deny')
        return { target, focus, hint: `An explicit Deny in ${name} blocks ${action}, and a Deny beats every Allow. Narrow that Deny (add a condition that exempts the legitimate caller) rather than adding more allows.` };
      return { target, focus, hint: `Nothing allows ${action} on this resource. Add an Allow statement for exactly that action and resource ARN to ${name}'s policy${board.iam?.keys[target] ? ' (KMS keys also need the key policy to allow it)' : ''}.` };
    }
    default:
      return { target, ruleRef, hint: hop.explain };
  }
}
