// Surprise incidents: when a player replays a build mission, one extra event is injected,
// drawn from a concept that is due for review. Only surprises the mission's reference design
// survives are eligible, so a surprise is always fair to the mission.

import type { ConceptId, EventSpec, Mission } from '../model';
import { runEvent } from '../sim/runner';

export interface SurpriseSpec {
  id: string;
  concepts: ConceptId[];
  /** Build the event for a mission, or null when it doesn't apply. */
  make: (m: Mission) => Omit<EventSpec, 'id' | 'concepts'> | null;
}

const sameCheck = (a: EventSpec, b: Omit<EventSpec, 'id' | 'concepts'>) => a.kind === b.kind && JSON.stringify(a.params) === JSON.stringify(b.params);

/** First eligible surprise for the due concepts (in priority order), or null. */
export function pickSurprise(mission: Mission, dueConcepts: ConceptId[], catalog: SurpriseSpec[]): EventSpec | null {
  if (mission.mode !== 'build') return null;
  const ctx = { budget: mission.budget, usage: mission.usage };
  for (const concept of dueConcepts)
    for (const s of catalog) {
      if (!s.concepts.includes(concept)) continue;
      const base = s.make(mission);
      if (!base || mission.events.some((e) => sameCheck(e, base))) continue;
      const ev: EventSpec = { ...base, id: `surprise-${s.id}`, concepts: s.concepts };
      if (runEvent(mission.reference, ev, ctx).status !== 'pass') continue;
      return ev;
    }
  return null;
}
