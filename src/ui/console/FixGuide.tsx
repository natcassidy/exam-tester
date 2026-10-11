import { useEffect, type RefObject } from 'react';
import type { FixPointer } from '../../engine/model';
import { useGame } from '../../store/game';
import { useLiveAudit } from '../board/useLiveAudit';
import { Icon } from '../shell/Icon';

/**
 * Scroll to and pulse the field or section a fix points at (labels match by prefix, case-insensitively),
 * or else the highlighted rule row of a security group, NACL or route table.
 */
export function usePointAt(root: RefObject<HTMLElement | null>, label: string | undefined, rule: boolean, deps: unknown[]) {
  useEffect(() => {
    if ((!label && !rule) || !root.current) return;
    let box: HTMLElement | null = null;
    if (label) {
      const want = label.toLowerCase();
      const text = (el: Element) => (el.textContent ?? '').trim().toLowerCase();
      const fields = [...root.current.querySelectorAll('label.field > span:first-child')];
      const heads = [...root.current.querySelectorAll('h4')];
      const hit = fields.find((el) => text(el).startsWith(want)) ?? heads.find((el) => text(el).startsWith(want));
      if (hit) box = (hit.closest('label.field') ?? hit.closest('.section') ?? hit) as HTMLElement;
    }
    box ??= root.current.querySelector('tr.hit') as HTMLElement | null;
    if (!box) return;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.classList.remove('focus-pulse');
    void box.offsetWidth; // restart the animation
    box.classList.add('focus-pulse');
    const el = box;
    const t = setTimeout(() => el.classList.remove('focus-pulse'), 3200);
    return () => {
      clearTimeout(t);
      el.classList.remove('focus-pulse');
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** "To fix" banner: shown on the object a Fix it button opened. */
export function FixBanner({ objectId }: { objectId?: string }) {
  const note = useGame((s) => s.fixNote);
  const missionId = useGame((s) => s.currentMissionId);
  const dismiss = useGame((s) => s.dismissFix);
  if (!note || note.missionId !== missionId || (note.target && note.target !== objectId)) return null;
  return (
    <div className="fix-banner" role="note">
      <Icon name="target" />
      <div>
        <div className="hint">To fix “{note.source}”</div>
        <div>{note.hint}</div>
      </div>
      <button className="btn ghost small" onClick={dismiss} aria-label="Dismiss">
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

/** Everything that failed because of this object, from the last run and the live checks, each with its fix. */
export function WhyRed({ objectId }: { objectId: string }) {
  const mission = useGame((s) => s.mission());
  const note = useGame((s) => (s.fixNote && s.fixNote.missionId === s.currentMissionId && (!s.fixNote.target || s.fixNote.target === objectId) ? s.fixNote : null));
  const results = useGame((s) => s.results[s.currentMissionId]);
  const stale = useGame((s) => !!s.results[s.currentMissionId] && s.resultsBoard[s.currentMissionId] !== s.board());
  const followFix = useGame((s) => s.followFix);
  const live = useLiveAudit();
  const items: { key: string; source: string; text: string; fix?: FixPointer }[] = [];
  for (const r of results ?? []) {
    if (r.status === 'pass') continue;
    const ev = mission.events.find((e) => e.id === r.eventId);
    const name = ev?.name ?? r.eventId;
    const lines = (r.detail?.lines ?? []).filter((l) => l.status === 'fail' && l.fix && (l.fix.target === objectId || l.about?.includes(objectId)));
    if (lines.length) for (const l of lines) items.push({ key: `${r.eventId}:${l.label}`, source: `${name}: ${l.label}`, text: l.value, fix: l.fix });
    else if (r.fixTarget === objectId || r.highlight.includes(objectId)) items.push({ key: r.eventId, source: name, text: r.summary, fix: r.fixHint ? { target: r.fixTarget, hint: r.fixHint, focus: r.fixFocus, ruleRef: r.fixRuleRef } : undefined });
  }
  for (const i of live?.byComponent[objectId] ?? []) if (!items.some((x) => x.text === i.finding.message)) items.push({ key: `live:${i.rule.id}`, source: `Live check: ${i.rule.title}`, text: i.finding.message, fix: i.finding.fix });
  // The fix banner above already says what Fix it came here to change.
  const shown = items.filter((it) => it.fix?.hint !== note?.hint);
  if (!shown.length) return null;
  return (
    <div className="why-red">
      <h4>
        <Icon name="warn" /> Why is this red?
      </h4>
      {stale && results && <p className="hint">From your last simulation run; the board has changed since.</p>}
      {shown.map((it) => (
        <div key={it.key} className="why-item">
          <div className="hint">{it.source}</div>
          <div>{it.text}</div>
          {it.fix && (
            <div className="why-fix">
              <span>{it.fix.hint}</span>
              {it.fix.target && it.fix.target !== objectId && (
                <button className="btn small primary" onClick={() => followFix(it.fix!, it.source)}>
                  Fix it
                </button>
              )}
              {it.fix.target === objectId && it.fix.focus && (
                <button className="btn small" onClick={() => followFix(it.fix!, it.source)}>
                  Show me
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
