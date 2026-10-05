// Approximate network round-trip times (ms) between client cities and AWS Regions, and between
// Regions. Rough public-internet / backbone figures, good enough to show why distance matters.

export const REGIONS: Record<string, { name: string; continent: string }> = {
  'us-east-1': { name: 'US East (N. Virginia)', continent: 'NA' },
  'us-west-2': { name: 'US West (Oregon)', continent: 'NA' },
  'eu-west-1': { name: 'Europe (Ireland)', continent: 'EU' },
  'ap-southeast-2': { name: 'Asia Pacific (Sydney)', continent: 'OC' },
  'ap-northeast-1': { name: 'Asia Pacific (Tokyo)', continent: 'AS' },
  'sa-east-1': { name: 'South America (São Paulo)', continent: 'SA' },
};

export const CITIES: Record<string, { label: string; continent: string; edge: number; rtt: Record<string, number> }> = {
  virginia: { label: 'Virginia', continent: 'NA', edge: 6, rtt: { 'us-east-1': 8, 'us-west-2': 70, 'eu-west-1': 75, 'ap-southeast-2': 200, 'ap-northeast-1': 150, 'sa-east-1': 120 } },
  london: { label: 'London', continent: 'EU', edge: 8, rtt: { 'us-east-1': 76, 'us-west-2': 140, 'eu-west-1': 12, 'ap-southeast-2': 260, 'ap-northeast-1': 220, 'sa-east-1': 190 } },
  saopaulo: { label: 'São Paulo', continent: 'SA', edge: 10, rtt: { 'us-east-1': 120, 'us-west-2': 180, 'eu-west-1': 190, 'ap-southeast-2': 310, 'ap-northeast-1': 260, 'sa-east-1': 8 } },
  tokyo: { label: 'Tokyo', continent: 'AS', edge: 8, rtt: { 'us-east-1': 160, 'us-west-2': 100, 'eu-west-1': 220, 'ap-southeast-2': 110, 'ap-northeast-1': 6, 'sa-east-1': 260 } },
  sydney: { label: 'Sydney', continent: 'OC', edge: 10, rtt: { 'us-east-1': 200, 'us-west-2': 140, 'eu-west-1': 260, 'ap-southeast-2': 10, 'ap-northeast-1': 110, 'sa-east-1': 310 } },
};

const PAIRS: Record<string, number> = {
  'us-east-1|us-west-2': 65,
  'us-east-1|eu-west-1': 70,
  'us-east-1|ap-southeast-2': 200,
  'us-east-1|ap-northeast-1': 150,
  'us-east-1|sa-east-1': 115,
  'us-west-2|eu-west-1': 130,
  'us-west-2|ap-southeast-2': 140,
  'us-west-2|ap-northeast-1': 100,
  'us-west-2|sa-east-1': 175,
  'eu-west-1|ap-southeast-2': 250,
  'eu-west-1|ap-northeast-1': 210,
  'eu-west-1|sa-east-1': 185,
  'ap-southeast-2|ap-northeast-1': 105,
  'ap-southeast-2|sa-east-1': 310,
  'ap-northeast-1|sa-east-1': 255,
};

export function regionRtt(a: string, b: string): number {
  if (a === b) return 1;
  return PAIRS[`${a}|${b}`] ?? PAIRS[`${b}|${a}`] ?? 150;
}

export function cityRtt(city: string, region: string): number {
  const c = CITIES[city] ?? CITIES.virginia;
  if (region === 'global') return c.edge;
  return c.rtt[region] ?? 150;
}

export function regionName(id: string): string {
  return REGIONS[id]?.name ?? id;
}
