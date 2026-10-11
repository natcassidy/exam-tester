import { runAudit } from '../../audit/rules';
import { EventHandler, result } from './context';

export const audit: EventHandler = (board, ev) => {
  const findings = runAudit(board, ev.params.rules as string[]);
  const applicable = findings.filter((f) => f.finding.status !== 'na');
  const failed = findings.filter((f) => f.finding.status === 'fail');
  const lines = findings.map((f) => ({ label: f.rule.title, value: f.finding.message, status: f.finding.status === 'na' ? ('warn' as const) : f.finding.status, fix: f.finding.fix, about: f.finding.highlight }));
  if (!applicable.length) return result(ev, { status: 'fail', incomplete: true, summary: 'Nothing to audit yet: none of the resources these checks cover are on the board.', detail: { lines }, lesson: 'Build the architecture, then audit it.', highlight: [] });
  if (failed.length) {
    const first = failed[0].finding;
    return result(ev, {
      status: 'fail',
      summary: failed.length === 1 ? first.message : `${failed.length} of ${findings.length} checks failed. First: ${first.message}`,
      detail: { lines },
      // The finding itself is in the summary and the detail line; the lesson says why the rule exists.
      lesson: failed.length === 1 ? failed[0].rule.why : `${failed[0].rule.title}: ${failed[0].rule.why}`,
      manual: [...new Set(failed.map((f) => f.rule.concept))],
      highlight: failed.flatMap((f) => f.finding.highlight),
      fixTarget: first.fix?.target,
      fixHint: first.fix?.hint,
      fixFocus: first.fix?.focus,
      fixRuleRef: first.fix?.ruleRef,
    });
  }
  return result(ev, { status: 'pass', summary: `All ${applicable.length} applicable checks passed.`, detail: { lines }, lesson: 'The design follows security best practice for these checks.', highlight: [] });
};
