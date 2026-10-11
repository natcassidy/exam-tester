// Who can reach whom through security groups, as a graph for the board's Security view.

import type { Board, Component, SgRule } from '../model';
import { fromWorld, sgOwners, sgPorts } from './sg';

/** One arrow: traffic that `to`'s security groups let in from `from` (a component or the internet). */
export interface SgEdge {
  from: string; // component id or 'internet'
  to: string;
  ports: string[];
  /** The whole internet into a private tier. */
  open: boolean;
  /** Who allows it: the group on `to` that holds the rule. */
  via: string[];
}

/** Entry points that are meant to accept the whole internet. */
const PUBLIC_ENTRY = ['alb', 'cloudfront', 'apigw'];

/** Which components each component's security groups accept traffic from. */
export function sgEdges(board: Board): SgEdge[] {
  const edges = new Map<string, SgEdge>();
  const add = (from: string, to: Component, r: SgRule, sgName: string, open: boolean) => {
    const k = `${from}>${to.id}`;
    const e = edges.get(k) ?? { from, to: to.id, ports: [], open, via: [] };
    if (!e.ports.includes(sgPorts(r))) e.ports.push(sgPorts(r));
    if (!e.via.includes(sgName)) e.via.push(sgName);
    e.open ||= open;
    edges.set(k, e);
  };
  for (const c of Object.values(board.components)) {
    for (const sgId of c.securityGroupIds ?? []) {
      const sg = board.securityGroups[sgId];
      if (!sg) continue;
      for (const r of sg.inbound) {
        if ('sg' in r.source) {
          const src = r.source.sg;
          for (const o of sgOwners(board, src)) if (o.id !== c.id) add(o.id, c, r, sg.name, false);
        } else if (fromWorld(r)) add('internet', c, r, sg.name, !PUBLIC_ENTRY.includes(c.type));
      }
    }
  }
  return [...edges.values()];
}

