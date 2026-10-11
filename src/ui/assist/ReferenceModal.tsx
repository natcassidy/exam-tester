import { useEffect, useMemo, useState } from 'react';
import type { ServiceType } from '../../engine/model';
import { compareToReference, relevantFirst, type RefDifference } from '../../engine/assist/compare';
import { describeSelection, selectionFor, type Selection, useGame } from '../../store/game';
import { Board } from '../board/Board';
import { BoardViewContext } from '../board/context';
import { describeObject } from '../diff/DiffView';
import { Icon } from '../shell/Icon';

function DiffItem({ d }: { d: RefDifference }) {
  const board = useGame((s) => s.board());
  const select = useGame((s) => s.select);
  const openReference = useGame((s) => s.openReference);
  const target = d.playerTarget ? selectionFor(board, d.playerTarget) : null;
  return (
    <li>
      <div className="hint">{d.area}</div>
      <div>{d.text}</div>
      {target && (
        <button
          className="btn small ghost"
          onClick={() => {
            select(target);
            openReference(null);
          }}
        >
          Open on my board →
        </button>
      )}
    </li>
  );
}

/** The mission's reference design next to a plain-language list of how the player's board differs. */
export function ReferenceModal() {
  const open = useGame((s) => s.referenceOpen);
  const close = useGame((s) => s.openReference);
  const mission = useGame((s) => s.mission());
  const board = useGame((s) => s.board());
  const results = useGame((s) => s.results[s.currentMissionId]);
  const [sel, setSel] = useState<Selection | null>(null);
  useEffect(() => setSel(null), [open?.eventId, mission.id]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  const ref = mission.reference;
  const diffs = useMemo(() => (open ? compareToReference(board, ref) : []), [open, board, ref]);
  const ev = open?.eventId ? mission.events.find((e) => e.id === open.eventId) : undefined;
  const r = open?.eventId ? results?.find((x) => x.eventId === open.eventId) : undefined;
  // The components the failing check is about, as types (ids differ between the two boards).
  const types = useMemo(() => {
    if (!r) return [] as ServiceType[];
    const ids = [...r.highlight, ...(r.fixTarget ? [r.fixTarget] : [])];
    const out = new Set<ServiceType>();
    for (const id of ids) {
      if (board.components[id]) out.add(board.components[id].type);
      for (const c of Object.values(board.components)) if (c.securityGroupIds?.includes(id)) out.add(c.type);
    }
    return [...out];
  }, [r, board]);
  const { relevant, other } = relevantFirst(diffs, types);
  const view = useMemo(() => ({ board: ref, readOnly: true, idPrefix: 'ref:', selection: sel, select: setSel }), [ref, sel]);

  if (!open || mission.incident || mission.diff) return null;
  return (
    <div className="modal-back" onClick={() => close(null)} role="dialog" aria-modal aria-label="Reference design">
      <div className="modal wide reference" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Reference design{ev ? ` · ${ev.name}` : ''}</h2>
          <button className="btn ghost small" onClick={() => close(null)} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="reference-body">
          <section className="reference-diffs" aria-label="Differences">
            {!diffs.length ? (
              <p>Your board matches the reference design. Run the simulation again.</p>
            ) : (
              <>
                <h4>{ev && types.length && other.length ? `What differs around ${ev.name}` : 'How your board differs'}</h4>
                <ul>
                  {relevant.map((d, i) => (
                    <DiffItem key={i} d={d} />
                  ))}
                </ul>
                {other.length > 0 && (
                  <details>
                    <summary>{other.length} other difference{other.length > 1 ? 's' : ''}</summary>
                    <ul>
                      {other.map((d, i) => (
                        <DiffItem key={i} d={d} />
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
            <p className="hint">The reference is one design that passes every check, not the only one. Change your own board; this window doesn't copy anything.</p>
          </section>
          <section className="reference-board" aria-label="Reference board">
            <div className="diff-board">
              <BoardViewContext.Provider value={view}>
                <Board />
              </BoardViewContext.Provider>
            </div>
            {sel && (
              <div className="reference-inspect">
                <h4>{describeSelection(ref, sel)} in the reference</h4>
                <table className="compare">
                  <tbody>
                    {describeObject(ref, sel).map(([k, v]) => (
                      <tr key={k}>
                        <td className="hint">{k}</td>
                        <td className="mono">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!sel && <p className="hint">Click anything on the reference board to see its settings.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
