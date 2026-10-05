import type { Mission } from '../../engine/model';
import { packetIncident } from './packet';
import { patchIncident } from './patch';
import { healthIncident } from './health';
import { doorIncident } from './door';
import { accessDeniedIncident } from './accessDenied';
import { kmsIncident } from './kms';
import { lockoutIncident } from './lockout';
import { zombieIncident } from './zombie';

export const INCIDENTS: Mission[] = [packetIncident, patchIncident, healthIncident, doorIncident, accessDeniedIncident, kmsIncident, lockoutIncident, zombieIncident];
