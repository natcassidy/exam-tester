import { createContext, useContext } from 'react';
import type { Board } from '../../engine/model';
import { Selection, useGame } from '../../store/game';

/** Lets the board render something other than the player's board (Spot the Difference). */
export interface BoardView {
  board: Board;
  readOnly: boolean;
  /** Prefix for droppable ids so two boards on one page don't collide. */
  idPrefix: string;
  selection: Selection | null;
  select: (s: Selection | null) => void;
}

export const BoardViewContext = createContext<BoardView | null>(null);

export function useBoardView(): BoardView {
  const ctx = useContext(BoardViewContext);
  const board = useGame((s) => s.board());
  const selection = useGame((s) => s.selection);
  const select = useGame((s) => s.select);
  return ctx ?? { board, readOnly: false, idPrefix: '', selection, select: (sel) => select(sel) };
}
