import type { Mission } from '../../engine/model';
import { portfolio } from './portfolio';
import { ledgerly } from './ledgerly';
import { dropshop } from './dropshop';
import { northwind } from './northwind';
import { INCIDENTS } from '../incidents';
import { DIFFS } from '../diffs';

/** Stage 1 build missions. */
export const MISSIONS: Mission[] = [portfolio, ledgerly, dropshop, northwind];
export { INCIDENTS, DIFFS };
export const ALL_MISSIONS: Mission[] = [...MISSIONS, ...INCIDENTS, ...DIFFS];
export const MISSION_BY_ID: Record<string, Mission> = Object.fromEntries(ALL_MISSIONS.map((m) => [m.id, m]));
