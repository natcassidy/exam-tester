import { computeRegionOutage, DR_STRATEGY_LABEL, RegionOutageParams } from '../dr';
import { regionName } from '../../net/geo';
import { EventHandler, fmtSec, result } from './context';

export const regionOutage: EventHandler = (board, ev) => {
  const p = ev.params as RegionOutageParams;
  const o = computeRegionOutage(board, p);
  const rtoOk = o.rtoSec <= p.rtoSec;
  const rpoOk = o.rpoSec <= p.rpoSec;
  const ok = rtoOk && rpoOk;
  const failing = o.tiers.filter((t) => t.rtoSec > p.rtoSec || t.rpoSec > p.rpoSec || t.status === 'fail');
  const strategyLine = { label: 'DR strategy', value: `${DR_STRATEGY_LABEL[o.strategy]}. ${o.strategyExplain}`, status: o.strategy === 'none' ? ('fail' as const) : ('pass' as const) };
  return result(ev, {
    status: ok ? 'pass' : 'fail',
    summary: `${regionName(p.region)} goes down. Measured RTO: ${fmtSec(o.rtoSec)} (requirement ≤ ${fmtSec(p.rtoSec)}) ${rtoOk ? '✓' : '✗'}, RPO: ${fmtSec(o.rpoSec)} (requirement ≤ ${fmtSec(p.rpoSec)}) ${rpoOk ? '✓' : '✗'}. Strategy: ${DR_STRATEGY_LABEL[o.strategy]}.`,
    detail: {
      lines: [
        strategyLine,
        ...o.tiers.map((t) => ({ label: t.tier, value: `RTO ${fmtSec(t.rtoSec)} · RPO ${fmtSec(t.rpoSec)} — ${t.explain}`, status: t.rtoSec > p.rtoSec || t.rpoSec > p.rpoSec || t.status === 'fail' ? ('fail' as const) : t.status === 'warn' ? ('warn' as const) : ('pass' as const) })),
      ],
    },
    lesson: ok
      ? `RTO = DNS detection + TTL + the slowest of (data recovery, compute start-up). ${DR_STRATEGY_LABEL[o.strategy]} meets these objectives.`
      : (failing[0]?.explain ?? 'Recovery takes too long.'),
    highlight: failing.map((t) => t.componentId).filter((x): x is string => !!x),
    fixTarget: failing[0]?.componentId,
    trace: o.trace,
    metrics: { rtoSec: o.rtoSec, rpoSec: o.rpoSec },
  });
};
