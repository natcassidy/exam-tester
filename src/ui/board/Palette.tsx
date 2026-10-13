import { useDraggable } from '@dnd-kit/core';
import type { ServiceType } from '../../engine/model';
import { SERVICES } from '../../content/services';
import { useGame } from '../../store/game';
import { Abbr } from '../shell/Abbr';
import { Icon } from '../shell/Icon';
import { hasHardMode, missionPalette } from '../../engine/palette';


function Item({ type, iconOnly = false }: { type: ServiceType; iconOnly?: boolean }) {
  const placing = useGame((s) => s.placing);
  const setPlacing = useGame((s) => s.setPlacing);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `pal:${type}`, data: { type } });
  const s = SERVICES[type];
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`pal-item ${placing === type ? 'placing' : ''}`}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      onClick={() => setPlacing(placing === type ? null : type)}
      aria-pressed={placing === type}
      aria-label={`Place ${s.name} (${s.zoneHint}). Drag onto the board, or tap then tap a zone.`}
      title={iconOnly ? `${s.name} · ${s.zoneHint}` : undefined}
    >
      <Abbr type={type} />
      {!iconOnly && (
        <span className="meta">
          <span>{s.name}</span>
          <small>{s.zoneHint}</small>
        </span>
      )}
    </button>
  );
}

export function Palette({ tray = false, collapsed = false, onToggle }: { tray?: boolean; collapsed?: boolean; onToggle?: () => void }) {
  const mission = useGame((s) => s.mission());
  const difficulty = useGame((s) => s.settings.difficulty ?? 'easy');
  const types = missionPalette(mission, difficulty);
  const toggle = onToggle && (
    <button className="btn ghost small palette-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand the services palette' : 'Collapse the services palette'} title={collapsed ? 'Expand' : 'Collapse to icons'}>
      <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
    </button>
  );
  if (collapsed && !tray)
    return (
      <div className="palette collapsed" aria-label="Services">
        {toggle}
        {types.map((t) => (
          <Item key={t} type={t} iconOnly />
        ))}
      </div>
    );
  if (!types.length)
    return tray ? null : (
      <div className="palette" aria-label="Services">
        <h3>Services</h3>
        <p className="hint">Nothing new to add for this incident. Fix what is already there: the smallest change wins.</p>
      </div>
    );
  if (tray)
    return (
      <div className="tray" aria-label="Services">
        {types.map((t) => (
          <Item key={t} type={t} />
        ))}
      </div>
    );
  return (
    <div className="palette" aria-label="Services">
      <h3>
        Services {hasHardMode(mission) && <span className={`tag ${difficulty === 'hard' ? 'accent' : 'muted'}`} title={difficulty === 'hard' ? 'Hard mode: some of these services are not needed' : 'Easy mode: only the services this mission can use'}>{difficulty === 'hard' ? 'HARD' : 'EASY'}</span>} {toggle}
      </h3>
      {types.map((t) => (
        <Item key={t} type={t} />
      ))}
      <p className="hint" style={{ marginTop: 8 }}>
        Drag a service onto the board, or click it and then click a zone. Placement only blocks what AWS itself forbids.
        {difficulty === 'hard' && hasHardMode(mission) && ' Hard mode: not every service here belongs in the design.'}
      </p>
    </div>
  );
}

export function PaletteOverlayItem({ type }: { type: ServiceType }) {
  const s = SERVICES[type];
  return (
    <div className="pal-item" style={{ width: 200, boxShadow: 'var(--shadow)' }}>
      <Abbr type={type} />
      <span className="meta">
        <span>{s.name}</span>
      </span>
    </div>
  );
}
