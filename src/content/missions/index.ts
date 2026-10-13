import type { Mission } from '../../engine/model';
import { portfolio } from './portfolio';
import { ledgerly } from './ledgerly';
import { dropshop } from './dropshop';
import { northwind } from './northwind';
import { drRegion } from './drRegion';
import { leaderboard } from './leaderboard';
import { branchOffice } from './branchOffice';
import { twelveVpcs } from './twelveVpcs';
import { invoices } from './invoices';
import { scans } from './scans';
import { clickstream } from './clickstream';
import { migration80 } from './migration80';
import { REFACTORS } from './refactors';
import { INCIDENTS } from '../incidents';
import { DIFFS } from '../diffs';
import { SOLUTIONS } from '../solutions';

/** Stage 3 build missions (breadth: multi-Region DR, hybrid, storage, data). */
export const STAGE3_MISSIONS: Mission[] = [drRegion, leaderboard, branchOffice, twelveVpcs, invoices, scans, clickstream, migration80];
/** Build missions: Stage 1, then Stage 3. */
export const MISSIONS: Mission[] = [portfolio, ledgerly, dropshop, northwind, ...STAGE3_MISSIONS];
export { INCIDENTS, DIFFS, REFACTORS };
export const ALL_MISSIONS: Mission[] = [...MISSIONS, ...INCIDENTS, ...DIFFS, ...REFACTORS];
export const MISSION_BY_ID: Record<string, Mission> = Object.fromEntries(ALL_MISSIONS.map((m) => [m.id, m]));

// Hard-mode distractors, "why not" notes and the solution review's key decisions live in one file.
for (const m of [...MISSIONS, ...REFACTORS]) Object.assign(m, SOLUTIONS[m.id] ?? {});
