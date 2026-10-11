import { estimateCost } from '../../cost/estimate';
import { EventHandler, fmtUsd, result } from './context';

const COST_TIPS: Record<string, string> = {
  nat: 'NAT gateways charge per GB processed: send S3 and DynamoDB traffic through a gateway endpoint (free), and avoid routing bulk data through NAT.',
  asg: 'Right-size the instance type, lower the minimum and desired capacity to what the load needs, or commit with Savings Plans.',
  ec2: 'Right-size the instance type, or commit with Savings Plans or Reserved Instances for steady load.',
  rds: 'Pick a smaller instance class if the load allows, and only pay for Multi-AZ and replicas where the requirements need them.',
  aurora: 'Use fewer or smaller replicas, or Aurora Serverless v2 for spiky load.',
  alb: 'A load balancer bills per hour and per LCU: one shared ALB can serve several services with listener rules.',
  cloudfront: 'Serve more from cache (a higher cache hit ratio) so fewer requests reach the origin.',
  s3: 'Move rarely read data to a cheaper storage class with a lifecycle rule.',
  dynamodb: 'Match the capacity mode to the traffic: provisioned (with auto scaling) for steady load, on-demand for spiky load.',
  lambda: 'Lower the memory size if the function is not CPU-bound, and shorten its duration.',
  vpn: 'A VPN is cheap per hour; check whether a Direct Connect port is oversized for the traffic.',
  dx: 'Pick the smallest port speed that carries the traffic.',
};

function costTip(type: string | undefined): string {
  return (type && COST_TIPS[type]) ?? 'Look for data paths that pay per GB and resources sized beyond the load.';
}

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
    fixHint: ok || !top ? undefined : `${top.item} is the biggest line item (${fmtUsd(top.monthly)}/month). ${costTip(board.components[top.componentId ?? '']?.type)}`,
    metrics: { monthly: est.total, budget },
  });
};
