// How missions are grouped for navigation: by mode, then by stage (or by course section for
// Course Labs). Shared by the top bar's chips and the mission index.

import type { Mission } from '../../engine/model';
import { ALL_MISSIONS } from '../../content/missions';
import { COURSE, COURSE_SECTIONS } from '../../content/course';
import { Mode, modeOf } from '../../store/game';

export const MODES: { id: Mode; label: string; short: string; noun: string }[] = [
  { id: 'build', label: 'Build', short: 'Build', noun: 'missions' },
  { id: 'incident', label: 'Incidents', short: 'Incidents', noun: 'incidents' },
  { id: 'diff', label: 'Spot the Difference', short: 'Diff', noun: 'rounds' },
  { id: 'refactor', label: 'Refactor', short: 'Refactor', noun: 'missions' },
  { id: 'course', label: 'Course Labs', short: 'Labs', noun: 'labs' },
];

export const DIVIDER: Record<number, { label: string; title: string }> = {
  2: { label: 'Stage 2', title: 'Stage 2: investigation' },
  3: { label: 'Breadth', title: 'Stage 3: breadth (multi-Region, hybrid, storage, data)' },
  4: { label: 'Cost', title: 'Stage 4: refactor for cost' },
};

export const COURSE_KIND = { fix: 'Fix: the board is built, but broken', finish: 'Finish: the board is partly built', build: 'Build: start from an empty board' };

export interface MissionGroup {
  key: string;
  title: string;
  /** Course sections without labs say why. */
  note?: string;
  missions: Mission[];
}

export function missionsOf(mode: Mode): Mission[] {
  return mode === 'course' ? COURSE : ALL_MISSIONS.filter((m) => modeOf(m) === mode);
}

/** A mode's missions in order, grouped by stage, or by course section (sections without labs included). */
export function groupsOf(mode: Mode): MissionGroup[] {
  if (mode === 'course') {
    return COURSE_SECTIONS.map((s) => ({
      key: `section-${s.n}`,
      title: `${s.n}. ${s.title}`,
      note: s.skip,
      missions: COURSE.filter((m) => m.course!.section === s.n),
    }));
  }
  const groups: MissionGroup[] = [];
  for (const m of missionsOf(mode)) {
    const key = `stage-${m.stage}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, title: m.stage === 1 ? 'Stage 1: foundations' : DIVIDER[m.stage]?.title ?? `Stage ${m.stage}`, missions: [] };
      groups.push(g);
    }
    g.missions.push(m);
  }
  return groups;
}

export function modeLabel(mode: Mode): string {
  return MODES.find((m) => m.id === mode)!.label;
}
