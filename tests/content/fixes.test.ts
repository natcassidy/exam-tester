// Every failure the player can hit must say what to change and where: "Fix it" has to open an
// object that exists, point at a control that exists, and come with a concrete hint.

import { describe, expect, it } from 'vitest';
import type { Board, EventResult, FixFocus, Mission } from '../../src/engine/model';
import { ALL_MISSIONS } from '../../src/content/missions';
import { runMission } from '../../src/engine/sim/runner';
import { findSubnet } from '../../src/engine/net/routing';

// Field labels and section headings the console renders, read from the UI source.
const UI_SOURCES = import.meta.glob(['../../src/ui/console/*.tsx', '../../src/ui/iam/*.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const UI_TEXT = Object.values(UI_SOURCES).join('\n');
const LABELS = new Set<string>();
for (const m of UI_TEXT.matchAll(/(?:label|title)="([^"]+)"/g)) LABELS.add(m[1].toLowerCase());
for (const m of UI_TEXT.matchAll(/<h4>([^<{]+)<\/h4>/g)) LABELS.add(m[1].trim().toLowerCase());
for (const m of UI_TEXT.matchAll(/'([A-Z][A-Za-z ()-]+)'/g)) LABELS.add(m[1].toLowerCase()); // headings chosen in expressions

const focusExists = (f: FixFocus) => [...LABELS].some((l) => l.startsWith(f.label.toLowerCase()));

function exists(board: Board, id: string): boolean {
  return !!(board.components[id] || board.securityGroups[id] || board.nacls[id] || board.routeTables[id] || findSubnet(board, id) || board.iam?.roles[id] || board.iam?.keys[id]);
}

function boardsOf(m: Mission): [string, Board][] {
  const out: [string, Board][] = m.mistakes.map((x) => [`mistake "${x.name}"`, x.board]);
  if (m.startingBoard) out.push(['starting board', m.startingBoard]);
  for (const w of m.incident?.wrongFixes ?? []) out.push([`wrong fix "${w.name}"`, w.board]);
  if (m.diff) out.push(['left board', m.diff.left], ['right board', m.diff.right]);
  return out;
}

function check(board: Board, r: EventResult, where: string) {
  if (r.status === 'pass' || r.incomplete) return;
  const ctx = `${where} · ${r.eventId}: ${r.summary}`;
  expect(r.fixHint, `${ctx}\nno fixHint`).toBeTruthy();
  if (r.fixTarget) {
    expect(exists(board, r.fixTarget), `${ctx}\nfixTarget ${r.fixTarget} doesn't exist`).toBe(true);
    expect(r.fixHint, `${ctx}\nfixTarget without fixHint`).toBeTruthy();
  }
  if (r.fixFocus) expect(focusExists(r.fixFocus), `${ctx}\nno console label starts with "${r.fixFocus.label}"`).toBe(true);
  if (r.fixRuleRef && r.fixTarget && board.securityGroups[r.fixTarget]) expect(r.fixRuleRef, ctx).toMatch(/^(inbound|outbound) rule/);
  for (const l of r.detail?.lines ?? []) {
    if (!l.fix) continue;
    expect(l.fix.hint, `${ctx}\nline "${l.label}" has a fix without a hint`).toBeTruthy();
    if (l.fix.target) expect(exists(board, l.fix.target), `${ctx}\nline "${l.label}" targets ${l.fix.target}, which doesn't exist`).toBe(true);
    if (l.fix.focus) expect(focusExists(l.fix.focus), `${ctx}\nline "${l.label}": no console label starts with "${l.fix.focus.label}"`).toBe(true);
  }
}

describe.each(ALL_MISSIONS.map((m) => [m.id, m] as const))('fix pointers in %s', (_id, mission) => {
  it.each(boardsOf(mission))('%s: every failure says what to change', (where, board) => {
    for (const r of runMission(board, mission)) check(board, r, where);
  });
});

describe('audit findings', () => {
  it('every failed audit line carries its own fix', () => {
    let seen = 0;
    for (const m of ALL_MISSIONS)
      for (const [where, board] of boardsOf(m))
        for (const r of runMission(board, m))
          for (const l of r.detail?.lines ?? [])
            if (l.status === 'fail' && m.events.find((e) => e.id === r.eventId)?.kind === 'audit') {
              seen++;
              expect(l.fix?.hint, `${m.id} ${where}: "${l.label}"`).toBeTruthy();
            }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('console label index', () => {
  it('finds real labels and headings, and rejects made-up ones', () => {
    for (const l of ['Publicly accessible', 'Security groups attached', 'Health check type', 'DB subnet group', 'Key policy']) expect(focusExists({ label: l }), l).toBe(true);
    expect(focusExists({ label: 'Not a real setting' })).toBe(false);
  });
});
