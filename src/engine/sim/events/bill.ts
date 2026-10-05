import { estimateCost } from '../../cost/estimate';
import { EventHandler, fmtUsd, result } from './context';

export const bill: EventHandler = (board, ev, ctx) => {
  const est = estimateCost(board, ctx.usage);
  const budget = ev.params?.budget ?? ctx.budget;
  const ok = est.total <= budget;
  const top = est.items[0];
  return result(ev, {
    status: ok ? 'pass' : 'fail',
    summary: `Estimated ${fmtUsd(est.total)}/month (approximate, us-east-1) against a ${fmtUsd(budget)} budget${ok ? '.' : `: ${fmtUsd(est.total - budget)} over.`}`,
    detail: { lines: [], lineItems: est.items },
    lesson: ok ? 'Within budget.' : `Biggest line item: ${top?.item} at ${fmtUsd(top?.monthly ?? 0)}. Look for data paths that pay per GB.`,
    highlight: ok || !top?.componentId ? [] : [top.componentId],
    fixTarget: top?.componentId,
    metrics: { monthly: est.total, budget },
  });
};
