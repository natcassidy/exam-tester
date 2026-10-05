import type { ServiceType } from '../../engine/model';
import { SERVICES } from '../../content/services';

export function Abbr({ type }: { type: ServiceType }) {
  const s = SERVICES[type];
  return (
    <span className={`abbr ${s.category}`} aria-hidden>
      {s.abbr}
    </span>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`${n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < n ? '' : 'off'}>
          ★
        </span>
      ))}
    </span>
  );
}
