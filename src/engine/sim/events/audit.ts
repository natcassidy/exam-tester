import { runAudit } from '../../audit/rules';
import { EventHandler, result } from './context';

export const audit: EventHandler = (board, ev) => {
  const findings = runAudit(board, ev.params.rules as string[]);
  const applicable = findings.filter((f) => f.finding.status !== 'na');
  const failed = findings.filter((f) => f.finding.status === 'fail');
  const lines = findings.map((f) => ({ label: f.rule.title, value: f.finding.message, status: f.finding.status === 'na' ? ('warn' as const) : f.finding.status }));
  if (!applicable.length) return result(ev, { status: 'fail', incomplete: true, summary: 'Nothing to audit yet: none of the resources these checks cover are on the board.', detail: { lines }, lesson: 'Build the architecture, then audit it.', highlight: [] });
  if (failed.length) {
    return result(ev, {
      status: 'fail',
      summary: `${failed.length} of ${findings.length} checks failed: ${failed.map((f) => f.rule.title).join('; ')}.`,
      detail: { lines },
      lesson: failed[0].finding.message,
      manual: [...new Set(failed.map((f) => f.rule.concept))],
      highlight: failed.flatMap((f) => f.finding.highlight),
      fixTarget: failed[0].finding.fixTarget,
    });
  }
  return result(ev, { status: 'pass', summary: `All ${applicable.length} applicable checks passed.`, detail: { lines }, lesson: 'The design follows security best practice for these checks.', highlight: [] });
};
