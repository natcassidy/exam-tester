// Hybrid connectivity requirements: "connected by tomorrow", "consistent 1 Gbps", "encrypted in
// transit", and surviving the loss of a link. Each runs the on-premises packet trace.

import type { Trace } from '../../model';
import { failingHop, traceFlow } from '../../net/trace';
import { resolveEndpoint } from '../../select';
import { DX_READY_DAYS, encrypted, fmtDays, linkMbps, links, readyDays, VPN_TUNNEL_GBPS } from '../hybrid';
import { EventHandler, result } from './context';

export interface ConnectivityParams {
  check: 'within' | 'bandwidth' | 'encrypted' | 'failover';
  /** The thing on-premises users must reach, and the port. */
  to: string;
  port: number;
  withinDays?: number;
  gbps?: number;
  /** failover: which kind of link fails. */
  failLink?: 'dx' | 'vpn';
  label?: string;
}

export const connectivity: EventHandler = (board, ev) => {
  const p = ev.params as ConnectivityParams;
  const to = resolveEndpoint(board, p.to);
  if (!to) return result(ev, { status: 'fail', incomplete: true, summary: `Nothing to connect to: ${p.label ?? p.to} isn't on the board yet.`, lesson: 'Place the workload first.', highlight: [] });
  const all = links(board);
  const run = (failedLinks: string[] = []): Trace => traceFlow(board, { from: 'onprem', to, protocol: 'tcp', port: p.port }, { failedLinks });
  const lines = all.map((l) => ({ label: l.name, value: `${l.type === 'dx' ? `Direct Connect ${l.config.type === 'dx' ? l.config.speedGbps : ''} Gbps` : 'Site-to-Site VPN'} · ready in ${fmtDays(readyDays(l))} · ~${linkMbps(board, l).toLocaleString()} Mbps${l.type === 'vpn' ? ' (over the internet)' : ' (dedicated)'} · ${encrypted(l) ? 'encrypted' : 'not encrypted'}` }));
  const linkOf = (t: Trace) => (t.linkId ? board.components[t.linkId] : undefined);
  const dropped = (t: Trace, why: string) => {
    const bad = failingHop(t);
    return result(ev, { status: 'fail', summary: `${why} ${bad?.explain ?? ''}`.trim(), detail: { lines }, lesson: 'Hybrid traffic needs a link (VPN or DX) on a gateway attached to the VPC, plus routes on both sides.', highlight: bad?.at.kind === 'component' ? [bad.at.id] : [], fixTarget: bad?.matched?.objectId ?? bad?.at.id, trace: t });
  };

  if (p.check === 'within') {
    const days = p.withinDays ?? 1;
    const late = all.filter((l) => readyDays(l) > days).map((l) => l.id);
    const t = run(late);
    if (t.result === 'dropped') return dropped(t, late.length && run().result === 'delivered' ? `Direct Connect takes weeks to provision (modelled ${DX_READY_DAYS} days), so it can't be the answer for "within ${fmtDays(days)}".` : `No working connection within ${fmtDays(days)}.`);
    const l = linkOf(t)!;
    return result(ev, { status: 'pass', summary: `Connected within ${fmtDays(readyDays(l))} over ${l.name}${late.length ? ` while the Direct Connect order is still being provisioned` : ''}.`, detail: { lines }, lesson: 'A Site-to-Site VPN is up in minutes over the existing internet connection.', highlight: [], trace: t });
  }

  const t = run();
  if (t.result === 'dropped') return dropped(t, 'On-premises traffic does not get through.');
  const l = linkOf(t)!;

  if (p.check === 'bandwidth') {
    const need = p.gbps ?? 1;
    if (l.type !== 'dx') return result(ev, { status: 'fail', summary: `Traffic rides ${l.name}, a VPN over the internet: up to ${VPN_TUNNEL_GBPS} Gbps per tunnel (and here no more than the ${board.onprem?.internetMbps ?? 100} Mbps uplink), with no guarantee of consistent throughput or latency.`, detail: { lines }, lesson: 'Consistent, predictable bandwidth needs a dedicated private connection: AWS Direct Connect.', highlight: [l.id], fixTarget: l.id, trace: t });
    if (l.config.type === 'dx' && l.config.speedGbps < need) return result(ev, { status: 'fail', summary: `${l.name} is a ${l.config.speedGbps} Gbps port; the nightly sync needs a consistent ${need} Gbps.`, detail: { lines }, lesson: 'Pick a port speed that covers the requirement.', highlight: [l.id], fixTarget: l.id, trace: t });
    return result(ev, { status: 'pass', summary: `Traffic uses ${l.name}: a dedicated ${l.config.type === 'dx' ? l.config.speedGbps : ''} Gbps Direct Connect port with consistent bandwidth.`, detail: { lines }, lesson: 'Direct Connect gives consistent network performance that the internet cannot.', highlight: [], trace: t });
  }

  if (p.check === 'encrypted') {
    if (!encrypted(l)) return result(ev, { status: 'fail', summary: `The traffic travels over ${l.name} unencrypted. Direct Connect is a private circuit, not an encrypted one${all.some((x) => x.type === 'vpn') ? '; the VPN only carries traffic when the DX link is down, because BGP prefers Direct Connect routes' : ''}.`, detail: { lines }, lesson: 'To encrypt over Direct Connect, run an IPsec Site-to-Site VPN over it, or use MACsec on a 10/100 Gbps dedicated connection.', highlight: [l.id], fixTarget: l.id, trace: t });
    return result(ev, { status: 'pass', summary: `Traffic uses ${l.name}, which is encrypted (${l.type === 'vpn' ? 'IPsec' : l.config.type === 'dx' && l.config.encryption === 'macsec' ? 'MACsec' : 'IPsec VPN over Direct Connect'}).`, detail: { lines }, lesson: 'Encryption in transit holds on the link that actually carries the traffic.', highlight: [], trace: t });
  }

  // failover
  const kind = p.failLink ?? 'dx';
  const failing = all.filter((x) => x.type === kind).map((x) => x.id);
  if (!failing.length) return result(ev, { status: 'fail', summary: `There is no ${kind === 'dx' ? 'Direct Connect' : 'VPN'} connection to fail over from.`, detail: { lines }, lesson: 'Build the primary link first.', highlight: [] });
  const t2 = run(failing);
  if (t2.result === 'dropped') return dropped(t2, `The ${kind === 'dx' ? 'Direct Connect link' : 'VPN'} fails and nothing takes over.`);
  const l2 = linkOf(t2)!;
  return result(ev, { status: 'pass', summary: `${board.components[failing[0]].name} fails; BGP withdraws its routes and traffic fails over to ${l2.name}.`, detail: { lines }, lesson: 'A VPN on the same gateway is the low-cost backup for Direct Connect.', highlight: [], trace: t2 });
};
