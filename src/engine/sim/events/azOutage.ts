import { computeAzOutage, AzOutageParams } from '../failure';
import { EventHandler, fixFields, fmtSec, result } from './context';

export const azOutage: EventHandler = (board, ev) => {
  const p = ev.params as AzOutageParams;
  const o = computeAzOutage(board, p);
  if (!o.tiers.some((t) => t.tier === 'Load balancer' || t.tier === 'Compute' || t.tier === 'Database')) {
    return result(ev, { status: 'fail', incomplete: true, summary: 'There is no application on the board to fail over.', lesson: 'Place the workload first.', highlight: [] });
  }
  const rtoOk = o.rtoSec <= p.rtoSec;
  const rpoOk = o.rpoSec <= p.rpoSec;
  const worst = [...o.tiers].sort((a, b) => b.rtoSec - a.rtoSec || b.rpoSec - a.rpoSec)[0];
  const failing = o.tiers.filter((t) => t.rtoSec > p.rtoSec || t.rpoSec > p.rpoSec);
  const ok = rtoOk && rpoOk;
  return result(ev, {
    status: ok ? 'pass' : 'fail',
    summary: `${p.az} fails. Measured RTO: ${fmtSec(o.rtoSec)} (requirement ≤ ${fmtSec(p.rtoSec)}) ${rtoOk ? '✓' : '✗'}, RPO: ${fmtSec(o.rpoSec)} (requirement ≤ ${fmtSec(p.rpoSec)}) ${rpoOk ? '✓' : '✗'}.`,
    detail: { lines: o.tiers.map((t) => ({ label: t.tier, value: `RTO ${fmtSec(t.rtoSec)} · RPO ${fmtSec(t.rpoSec)} — ${t.explain}`, status: t.rtoSec > p.rtoSec || t.rpoSec > p.rpoSec ? 'fail' : t.status === 'warn' ? 'warn' : 'pass', fix: t.rtoSec > p.rtoSec || t.rpoSec > p.rpoSec ? t.fix : undefined, about: t.componentId ? [t.componentId] : undefined })) },
    lesson: ok ? 'Every tier survives losing an AZ inside the recovery objectives.' : (failing[0] ?? worst).explain,
    highlight: failing.map((t) => t.componentId).filter((x): x is string => !!x),
    ...(ok ? {} : fixFields((failing[0] ?? worst)?.fix ?? ((failing[0] ?? worst)?.componentId ? { target: (failing[0] ?? worst)!.componentId!, hint: (failing[0] ?? worst)!.explain } : undefined))),
    metrics: { rtoSec: o.rtoSec, rpoSec: o.rpoSec },
  });
};
