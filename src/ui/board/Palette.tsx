import { useDraggable } from '@dnd-kit/core';
import type { ServiceType } from '../../engine/model';
import { SERVICES } from '../../content/services';
import { useGame } from '../../store/game';
import { Abbr } from '../shell/Abbr';

const ALL: ServiceType[] = [
  'cloudfront', 'route53', 'waf', 'apigw', 'lambda', 'sqs', 'dynamodb', 's3', 'kinesis', 'firehose', 'athena', 'backup', 'tgw', 'dms',
  'alb', 'asg', 'ec2', 'rds', 'aurora', 'nat', 'igw', 'vpce', 'pcx', 'vgw',
  'cgw', 'vpn', 'dx', 'snow', 'datasync', 'savings',
];

function Item({ type }: { type: ServiceType }) {
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
    >
      <Abbr type={type} />
      <span className="meta">
        <span>{s.name}</span>
        <small>{s.zoneHint}</small>
      </span>
    </button>
  );
}

export function paletteFor(palette?: ServiceType[]): ServiceType[] {
  return palette ? ALL.filter((t) => palette.includes(t)) : ALL;
}

export function Palette({ tray = false }: { tray?: boolean }) {
  const mission = useGame((s) => s.mission());
  const types = paletteFor(mission.palette);
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
      <h3>Services</h3>
      {types.map((t) => (
        <Item key={t} type={t} />
      ))}
      <p className="hint" style={{ marginTop: 8 }}>
        Drag a service onto the board, or click it and then click a zone. Placement only blocks what AWS itself forbids.
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
