import { useState } from 'react';
import { CONCEPTS } from '../../content/concepts';
import { MANUAL } from '../../content/manual';
import { DOMAIN_LABELS, Domain } from '../../engine/model';
import { useGame } from '../../store/game';
import { Markdown } from './Markdown';

export function FieldManual() {
  const openId = useGame((s) => s.manualOpen);
  const open = useGame((s) => s.openManual);
  const mission = useGame((s) => s.mission());
  const [q, setQ] = useState('');
  if (!openId) return null;
  const id = openId === 'index' ? mission.concepts[0] : openId;
  const list = CONCEPTS.filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()) || (MANUAL[c.id] ?? '').toLowerCase().includes(q.toLowerCase()));
  const domains = Object.keys(DOMAIN_LABELS) as Domain[];
  return (
    <div className="modal-back" onClick={() => open(null)} role="dialog" aria-modal aria-label="Field Manual">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Field Manual</h2>
          <input type="text" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the manual" />
          <button className="btn ghost small" onClick={() => open(null)} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="manual">
          <nav>
            {domains.map((d) => {
              const items = list.filter((c) => c.domain === d);
              if (!items.length) return null;
              return (
                <div key={d}>
                  <h5>{DOMAIN_LABELS[d]}</h5>
                  {items.map((c) => (
                    <button key={c.id} className={c.id === id ? 'on' : ''} onClick={() => open(c.id)}>
                      {c.title} <span className="hint mono">{c.task}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
          <article>{MANUAL[id] ? <Markdown src={MANUAL[id]} onXref={(x) => open(x)} /> : <p className="hint">No entry yet.</p>}</article>
        </div>
      </div>
    </div>
  );
}
