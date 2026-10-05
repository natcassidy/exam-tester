import type { Board, Hop } from '../../engine/model';
import { allSubnets } from '../../engine/net/routing';

/** DOM selector for the board element a hop should light up. */
export function anchorSelector(board: Board, hop: Hop, prevSubnet: string | null): string | null {
  const { kind, id } = hop.at;
  if (kind === 'internet') return '[data-node-id="internet"]';
  if (kind === 'service') return '[data-node-id="svc"]';
  if (kind === 'onprem') return '[data-node-id="onprem"]';
  if (kind === 'component' || kind === 'nat' || kind === 'igw' || kind === 'vpce') return board.components[id] ? `[data-node-id="${id}"]` : null;
  if (kind === 'subnet') return `[data-subnet-id="${id}"]`;
  // Permission checks light up the component that runs as the role, or the bucket the key protects.
  if (kind === 'role') {
    const c = Object.values(board.components).find((x) => x.roleId === id);
    return c ? `[data-node-id="${c.id}"]` : null;
  }
  if (kind === 'key') {
    const c = Object.values(board.components).find((x) => x.config.type === 's3' && x.config.kmsKeyId === id);
    return c ? `[data-node-id="${c.id}"]` : null;
  }
  if (kind === 'sg') {
    const owner = Object.values(board.components).find((c) => c.securityGroupIds?.includes(id));
    return owner ? `[data-node-id="${owner.id}"]` : null;
  }
  const field = kind === 'nacl' ? 'naclId' : kind === 'routeTable' ? 'routeTableId' : null;
  if (!field) return null;
  const subs = allSubnets(board).filter((s) => s[field] === id);
  const pick = subs.find((s) => s.id === prevSubnet) ?? subs[0];
  return pick ? `[data-subnet-id="${pick.id}"]` : null;
}

export function subnetOfSelector(board: Board, hop: Hop): string | null {
  if (hop.at.kind === 'subnet') return hop.at.id;
  if (hop.at.kind === 'component') {
    const c = board.components[hop.at.id];
    if (c?.placement.kind === 'subnet') return c.placement.refId;
  }
  return null;
}
