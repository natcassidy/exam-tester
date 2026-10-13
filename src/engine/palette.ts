import type { Mission, ServiceType } from './model';

export type Difficulty = 'easy' | 'hard';

/** Every service, in the order the palette lists them. */
export const PALETTE_ORDER: ServiceType[] = [
  'cloudfront', 'route53', 'waf', 'apigw', 'lambda', 'sqs', 'dynamodb', 's3', 'kinesis', 'firehose', 'athena', 'backup', 'tgw', 'dms',
  'alb', 'asg', 'ec2', 'rds', 'aurora', 'nat', 'igw', 'vpce', 'pcx', 'vgw',
  'cgw', 'vpn', 'dx', 'snow', 'datasync', 'savings',
];

/**
 * The services a mission offers. Easy: the mission's own short list. Hard: that list plus plausible
 * services the design doesn't need, mixed in so the palette no longer gives the architecture away.
 * Incidents and Spot the Difference rounds are the same in both modes.
 */
export function missionPalette(m: Pick<Mission, 'palette' | 'distractors' | 'mode'>, difficulty: Difficulty = 'easy'): ServiceType[] {
  if (!m.palette) return PALETTE_ORDER;
  const extra = difficulty === 'hard' && (m.mode === 'build' || m.mode === 'refactor') ? (m.distractors ?? []) : [];
  const set = new Set<ServiceType>([...m.palette, ...extra]);
  return PALETTE_ORDER.filter((t) => set.has(t));
}

/** Whether a mission plays differently in hard mode. */
export const hasHardMode = (m: Pick<Mission, 'distractors' | 'mode'>) => (m.mode === 'build' || m.mode === 'refactor') && !!m.distractors?.length;
