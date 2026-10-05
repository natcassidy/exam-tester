// Mini-incidents for the daily session: read the alert and the logs, then pick the root cause
// from a short list. Deterministic: the same incident always gets the same four options.

import type { Mission } from '../model';
import { hashString } from '../mastery/exam';
import { listSuspects, Suspect } from './suspects';

export function miniIncidentOptions(m: Mission, n = 4): Suspect[] {
  if (!m.incident || !m.startingBoard) return [];
  const all = listSuspects(m.startingBoard);
  const root = all.find((s) => s.id === m.incident!.rootCause);
  if (!root) return [];
  const others = all.filter((s) => s.id !== root.id);
  // Plausible first: other settings on the same object, then the same kind of object, then the rest.
  const kind = (id: string) => id.split(':')[0];
  const rank = (s: Suspect) => (s.objectId === root.objectId ? 0 : kind(s.id) === kind(root.id) ? 1 : 2);
  const picked = others.sort((a, b) => rank(a) - rank(b) || hashString(`${m.id}|${a.id}`) - hashString(`${m.id}|${b.id}`)).slice(0, n - 1);
  return [root, ...picked].sort((a, b) => hashString(`${m.id}#${a.id}`) - hashString(`${m.id}#${b.id}`));
}
