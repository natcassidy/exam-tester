import type { ComponentId, Trace } from '../../model';
import { traceFlow, failingHop } from '../../net/trace';
import { resolveEndpoint } from '../../select';
import { EventHandler, result } from './context';

export interface ReachabilityParams {
  from: string;
  to: string;
  port: number;
  protocol?: 'tcp' | 'udp';
  expect: 'allow' | 'deny';
  clientCity?: string;
  maxLatencyMs?: number;
  /** Every source subnet must leave the VPC this way (e.g. 'vpce'). */
  expectVia?: 'vpce' | 'nat' | 'igw';
  label?: { from?: string; to?: string };
}

function highlightOf(t: Trace): ComponentId[] {
  const ids = new Set<string>();
  for (const h of [...t.hops, ...t.returnHops]) if (h.result === 'deny' && h.at.kind !== 'sg' && h.at.kind !== 'nacl' && h.at.kind !== 'routeTable') ids.add(h.at.id);
  return [...ids];
}

export const reachability: EventHandler = (board, ev) => {
  const p = ev.params as ReachabilityParams;
  const from = resolveEndpoint(board, p.from);
  const to = resolveEndpoint(board, p.to);
  const missing = !from ? p.label?.from ?? p.from : !to ? p.label?.to ?? p.to : null;
  if (missing) {
    return result(ev, { status: 'fail', incomplete: true, summary: `Nothing to test: ${missing} isn't on the board yet.`, lesson: 'Place the components this requirement depends on, then run again.', highlight: [] });
  }
  const t = traceFlow(board, { from: from!, to: to!, protocol: p.protocol ?? 'tcp', port: p.port, clientCity: p.clientCity });
  const bad = failingHop(t);
  const fixTarget = bad?.matched?.objectId ?? bad?.at.id;
  const metrics: Record<string, number> = {};
  if (t.latencyMs !== undefined) metrics.latencyMs = t.latencyMs;

  if (p.expect === 'deny') {
    if (t.result === 'dropped') {
      return result(ev, { status: 'pass', summary: `Blocked, as required: ${bad?.explain ?? 'the packet was dropped.'}`, lesson: 'Defense in depth: this path is closed.', highlight: [], trace: t, metrics });
    }
    return result(ev, {
      status: 'fail',
      summary: `Reachable when it must not be: the packet was delivered end to end.`,
      lesson: 'Something that should be private is reachable. Check the subnet (public or private), the public IP / publicly accessible setting, and security group sources.',
      highlight: to && to !== 'internet' ? [to] : [],
      fixTarget: to ?? undefined,
      trace: t,
      metrics,
    });
  }

  if (t.result === 'dropped') {
    const where = t.paths?.filter((x) => x.result === 'dropped').map((x) => x.subnetId);
    return result(ev, {
      status: 'fail',
      summary: `Dropped${bad ? ` at ${bad.check}${bad.matched ? ` (${bad.matched.ruleRef})` : ''}` : ''}: ${bad?.explain ?? 'no path.'}${where && t.paths!.length > 1 ? ` Failing from: ${where.join(', ')}.` : ''}`,
      lesson: bad?.check === 'nacl-in' || bad?.check === 'nacl-out' ? 'NACLs are stateless and ordered. Return traffic needs ephemeral ports 1024-65535.' : 'Follow the trace: every hop must allow the flow, in both directions.',
      highlight: highlightOf(t),
      fixTarget,
      trace: t,
      metrics,
    });
  }
  if (p.expectVia) {
    const wrong = (t.paths ?? [{ subnetId: '', result: t.result, via: t.via }]).filter((x) => x.via !== p.expectVia);
    if (wrong.length) {
      return result(ev, {
        status: 'fail',
        summary: `Delivered, but traffic from ${wrong.map((w) => w.subnetId).join(', ')} leaves via ${wrong[0].via.toUpperCase()} instead of the ${p.expectVia === 'vpce' ? 'gateway endpoint' : p.expectVia.toUpperCase()}.`,
        lesson: 'A gateway endpoint only affects the route tables it is associated with. Every private route table needs the association.',
        highlight: [from!],
        fixTarget: Object.values(board.components).find((c) => c.type === 'vpce')?.id ?? from!,
        trace: t,
        metrics,
      });
    }
  }
  if (p.maxLatencyMs !== undefined && (t.latencyMs ?? 0) > p.maxLatencyMs) {
    return result(ev, {
      status: 'fail',
      summary: `Delivered, but too slow: ~${t.latencyMs} ms from ${p.clientCity} (requirement ≤ ${p.maxLatencyMs} ms).`,
      lesson: 'Distance is latency. Serve from the edge (CloudFront) so most requests never cross an ocean.',
      highlight: [to!],
      fixTarget: to!,
      trace: t,
      metrics,
    });
  }
  return result(ev, {
    status: 'pass',
    summary: `Delivered in ${t.hops.length} hops${t.returnHops.length ? `, response returned in ${t.returnHops.length}` : ''}${t.latencyMs !== undefined ? ` · ~${t.latencyMs} ms` : ''}${t.via !== 'local' && t.via !== 'none' ? ` · via ${t.via.toUpperCase()}` : ''}.`,
    lesson: 'Every hop allowed the flow, forward and back.',
    highlight: [],
    trace: t,
    metrics,
  });
};
