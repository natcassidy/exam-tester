import type { Board } from '../../engine/model';

/** Scroll the board to a component (or the components wearing a security group) and pulse it. */
export function revealOnBoard(board: Board, ids: string[]) {
  const nodes = ids.flatMap((id) => (board.securityGroups[id] ? Object.values(board.components).filter((c) => c.securityGroupIds?.includes(id)).map((c) => c.id) : [id]));
  const els = nodes.map((id) => document.querySelector(`.board [data-node-id="${CSS.escape(id)}"]`) as HTMLElement | null).filter((e): e is HTMLElement => !!e);
  if (!els.length) return false;
  els[0].scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  for (const el of els) {
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
    setTimeout(() => el.classList.remove('pulse'), 2600);
  }
  return true;
}
