// Migration: data size, link bandwidth and deadline. Shows the arithmetic.

import { componentsOfType } from '../../board';
import { DX_READY_DAYS, fmtDays, linkMbps, links, readyDays, transferDays } from '../hybrid';
import { EventHandler, result } from './context';

export interface MigrationParams {
  scope: 'files' | 'delta' | 'database';
  tb?: number;
  deadlineDays: number;
  /** delta: data changed per day while the bulk copy is in flight. */
  changeGbPerDay?: number;
  /** database */
  dbGb?: number;
  maxDowntimeMin?: number;
}

/** Snowball Edge Storage Optimized: ~80 TB usable per device in this model (newer devices hold more). */
export const SNOWBALL_TB = 80;
export const SNOW_SHIP_DAYS = 2;
export const SNOW_COPY_MBPS = 4000; // ~500 MB/s per device over the local 10 GbE network
export const SNOW_IMPORT_DAYS = 1.5;
export const DMS_CUTOVER_MIN = 5;

export function snowballDays(tb: number, devices: number): number {
  const perDevice = Math.min(tb / devices, SNOWBALL_TB);
  return SNOW_SHIP_DAYS + transferDays(perDevice, SNOW_COPY_MBPS) + SNOW_SHIP_DAYS + SNOW_IMPORT_DAYS;
}

export const migration: EventHandler = (board, ev) => {
  const p = ev.params as MigrationParams;
  const deadline = p.deadlineDays;
  const usable = links(board).filter((l) => readyDays(l) <= deadline);
  const bestNet = usable.length ? Math.max(...usable.map((l) => linkMbps(board, l))) : board.onprem?.internetMbps ?? 100;
  const netLabel = usable.length ? usable.sort((a, b) => linkMbps(board, b) - linkMbps(board, a))[0].name : 'the internet uplink';
  const dx = links(board).filter((l) => l.type === 'dx');

  if (p.scope === 'files') {
    const tb = p.tb ?? 80;
    const lines: { label: string; value: string; status?: 'pass' | 'warn' | 'fail' }[] = [];
    const snow = componentsOfType(board, 'snow')[0];
    const ds = componentsOfType(board, 'datasync')[0];
    const net = transferDays(tb, bestNet);
    lines.push({ label: 'Online', value: `${tb} TB over ${netLabel} at ${bestNet.toLocaleString()} Mbps = ${tb} × 8,000,000 Mb ÷ ${bestNet} Mbps ≈ ${fmtDays(net)} at 100% utilisation.`, status: net <= deadline ? 'pass' : 'fail' });
    for (const d of dx) if (readyDays(d) > deadline) lines.push({ label: d.name, value: `Direct Connect takes weeks to provision (modelled ${DX_READY_DAYS} days): it isn't there before the deadline. At ${linkMbps(board, d) / 1000} Gbps the copy itself would take ${fmtDays(transferDays(tb, linkMbps(board, d)))}.`, status: 'fail' });
    let best = Infinity;
    let how = '';
    if (ds && ds.config.type === 'datasync' && ds.config.destId) {
      best = net;
      how = `${ds.name} over ${netLabel}`;
    }
    if (snow && snow.config.type === 'snow' && snow.config.destId) {
      const devices = snow.config.devices;
      const fits = devices * SNOWBALL_TB >= tb;
      const days = snowballDays(tb, devices);
      lines.push({ label: snow.name, value: `${devices} × Snowball Edge (~${SNOWBALL_TB} TB each): ship ${SNOW_SHIP_DAYS} d + copy ${fmtDays(transferDays(Math.min(tb / devices, SNOWBALL_TB), SNOW_COPY_MBPS))} on the local network + ship back ${SNOW_SHIP_DAYS} d + import ${SNOW_IMPORT_DAYS} d ≈ ${fmtDays(days)}.${fits ? '' : ` ${devices} device(s) hold only ${devices * SNOWBALL_TB} TB.`}`, status: fits && days <= deadline ? 'pass' : 'fail' });
      if (fits && days < best) {
        best = days;
        how = snow.name;
      }
    }
    if (!how) return result(ev, { status: 'fail', summary: `Nothing moves the ${tb} TB. Add a transfer method: DataSync (online) or a Snowball job (offline).`, detail: { lines }, lesson: 'Online: DataSync over VPN/DX. Offline: the Snow family, when the network would take too long.', highlight: [] });
    const ok = best <= deadline;
    return result(ev, {
      status: ok ? 'pass' : 'fail',
      summary: `${tb} TB via ${how}: ≈ ${fmtDays(best)} (deadline ${fmtDays(deadline)}) ${ok ? '✓' : '✗'}.`,
      detail: { lines },
      lesson: ok ? 'Pick the transfer method from the arithmetic, not from habit.' : `When the network would take ${fmtDays(net)}, ship the data: a Snowball job moves tens of terabytes in about a week.`,
      highlight: ok ? [] : [(snow ?? ds)!.id],
      fixTarget: (snow ?? ds)?.id,
      metrics: { days: best },
    });
  }

  if (p.scope === 'delta') {
    const gb = p.changeGbPerDay ?? 100;
    const ds = componentsOfType(board, 'datasync').find((d) => d.config.destId);
    const snow = componentsOfType(board, 'snow')[0];
    const capGbDay = (bestNet * 1e6 * 86400) / 8 / 1e9;
    if (!ds) return result(ev, { status: 'fail', summary: `${snow ? `While the Snowball devices are in transit (~${fmtDays(snowballDays(p.tb ?? 80, snow.config.type === 'snow' ? snow.config.devices : 1))}), users keep changing files (~${gb} GB/day).` : `Files keep changing (~${gb} GB/day).`} Nothing copies those changes, so the cut-over loses a week of work.`, detail: { lines: [] }, lesson: 'Combine offline and online: Snowball for the bulk, then DataSync incremental runs for what changed since.', highlight: snow ? [snow.id] : [], fixTarget: snow?.id });
    const ok = capGbDay >= gb && ds.config.type === 'datasync' && ds.config.schedule !== 'once';
    return result(ev, {
      status: ok ? 'pass' : 'fail',
      summary: ok
        ? `${ds.name} runs ${ds.config.type === 'datasync' ? ds.config.schedule : ''} and only transfers what changed (~${gb} GB/day; ${netLabel} carries ~${Math.round(capGbDay).toLocaleString()} GB/day).`
        : ds.config.type === 'datasync' && ds.config.schedule === 'once'
          ? `${ds.name} runs once, so changes made after it ran are never copied.`
          : `${netLabel} carries ~${Math.round(capGbDay)} GB/day, less than the ${gb} GB/day of changes.`,
      detail: { lines: [] },
      lesson: 'DataSync tasks compare source and destination and copy only the differences on every scheduled run.',
      highlight: ok ? [] : [ds.id],
      fixTarget: ds.id,
    });
  }

  // database
  const gb = p.dbGb ?? 500;
  const maxMin = p.maxDowntimeMin ?? 15;
  const dms = componentsOfType(board, 'dms').find((d) => d.config.targetId);
  const lines = [{ label: 'Full copy', value: `${gb} GB over ${netLabel} at ${bestNet} Mbps ≈ ${fmtDays(transferDays(gb / 1000, bestNet))}.` }];
  if (!dms) return result(ev, { status: 'fail', summary: `Nothing migrates the ${gb} GB database while it keeps taking writes.`, detail: { lines }, lesson: 'AWS DMS copies the database (full load) and then replicates ongoing changes (CDC) until you cut over.', highlight: [] });
  if (!usable.length) return result(ev, { status: 'fail', summary: `${dms.name} needs private connectivity to the source database, and no VPN or DX connection is ready before the deadline.`, detail: { lines }, lesson: 'Set up a Site-to-Site VPN for DMS to reach the on-premises database.', highlight: [dms.id], fixTarget: dms.id });
  if (dms.config.type === 'dms' && dms.config.mode === 'full-load') {
    const min = transferDays(gb / 1000, bestNet) * 24 * 60;
    return result(ev, { status: 'fail', summary: `Full load only: writes must stop for the whole copy (~${fmtDays(min / 1440)}) or every change made during it is lost. Allowed downtime: ${maxMin} min.`, detail: { lines }, lesson: 'Use "full load and ongoing replication (CDC)": the source stays live until a short cut-over.', highlight: [dms.id], fixTarget: dms.id });
  }
  return result(ev, { status: 'pass', summary: `${dms.name}: full load while the source stays live, then change data capture keeps the target in sync. Cut-over downtime ≈ ${DMS_CUTOVER_MIN} min (allowed ${maxMin}).`, detail: { lines }, lesson: 'DMS with CDC turns a database migration into a few minutes of downtime.', highlight: [] });
};
