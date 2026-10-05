// Hybrid connectivity facts shared by the connectivity and migration events.

import type { Board, Component, ConfigOf } from '../model';

/** A Site-to-Site VPN is up in minutes; a dedicated Direct Connect port takes weeks to provision. */
export const VPN_READY_DAYS = 0.01;
export const DX_READY_DAYS = 30;
/** Per-tunnel VPN throughput (AWS quota: up to 1.25 Gbps per tunnel). */
export const VPN_TUNNEL_GBPS = 1.25;

export function links(board: Board): (Component & { config: ConfigOf<'vpn'> | ConfigOf<'dx'> })[] {
  return Object.values(board.components).filter((c) => c.config.type === 'vpn' || c.config.type === 'dx') as (Component & { config: ConfigOf<'vpn'> | ConfigOf<'dx'> })[];
}

export function readyDays(c: Component): number {
  return c.type === 'dx' ? DX_READY_DAYS : VPN_READY_DAYS;
}

/** Usable bandwidth of a link in Mbps: VPN is capped by the data centre's internet uplink. */
export function linkMbps(board: Board, c: Component): number {
  if (c.config.type === 'dx') return c.config.speedGbps * 1000;
  return Math.min(VPN_TUNNEL_GBPS * 1000, board.onprem?.internetMbps ?? 100);
}

export function encrypted(c: Component): boolean {
  if (c.config.type === 'vpn') return true;
  if (c.config.type === 'dx') return c.config.encryption !== 'none';
  return false;
}

/** Days to move `tb` terabytes at `mbps` megabits per second (at 100% utilisation). */
export function transferDays(tb: number, mbps: number): number {
  return (tb * 1e12 * 8) / (mbps * 1e6) / 86400;
}

export function fmtDays(d: number): string {
  if (d < 1 / 24) return `${Math.max(1, Math.round(d * 24 * 60))} min`;
  if (d === 1) return '1 day';
  if (d < 2) return `${(d * 24).toFixed(1)} hours`;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}
