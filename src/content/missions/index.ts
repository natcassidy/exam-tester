import type { Mission } from '../../engine/model';
import { portfolio } from './portfolio';
import { ledgerly } from './ledgerly';
import { dropshop } from './dropshop';
import { northwind } from './northwind';

export const MISSIONS: Mission[] = [portfolio, ledgerly, dropshop, northwind];
export const MISSION_BY_ID: Record<string, Mission> = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
