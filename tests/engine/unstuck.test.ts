// Store-level checks of the "getting unstuck" features: undo/redo, Fix it, hints and their mastery cost.

import { beforeEach, describe, expect, it } from 'vitest';
import * as ops from '../../src/engine/board';
import { useGame } from '../../src/store/game';
import { ledgerly } from '../../src/content/missions/ledgerly';
import { mastery } from '../../src/engine/mastery/mastery';
import { evidenceFor } from '../../src/engine/mastery/evidence';
import { evidenceLabel } from '../../src/ui/mastery/labels';

const g = () => useGame.getState();

beforeEach(() => {
  useGame.setState({ boards: {}, history: {}, results: {}, resultsBoard: {}, assists: {}, conceptEvidence: [], fixNote: null, selection: null, incidents: {}, toasts: [], surprise: {} });
  g().setMission('ledgerly');
});

describe('undo and redo', () => {
  it('steps back and forward through edits, and a new edit clears redo', () => {
    g().place('alb', { kind: 'subnet', refId: 'public-a' });
    g().place('asg', { kind: 'subnet', refId: 'app-a' });
    const count = () => Object.keys(g().board().components).length;
    const two = count();
    g().undo();
    expect(count()).toBe(two - 1);
    g().undo();
    expect(count()).toBe(two - 2);
    g().undo(); // nothing left: a no-op
    expect(count()).toBe(two - 2);
    g().redo();
    expect(count()).toBe(two - 1);
    g().place('nat', { kind: 'subnet', refId: 'public-a' });
    g().redo(); // the new edit dropped the redo stack
    expect(count()).toBe(two);
  });

  it('a reset of a build mission is undoable; the selection of a removed object is dropped', () => {
    g().place('alb', { kind: 'subnet', refId: 'public-a' });
    const before = g().board();
    g().resetBoard();
    expect(g().boards.ledgerly).toBeUndefined();
    g().undo();
    expect(g().board()).toBe(before);
    const id = Object.values(before.components).find((c) => c.type === 'alb')!.id;
    g().select({ kind: 'component', id });
    g().undo();
    expect(g().selection).toBeNull();
  });
});

describe('the reset toast', () => {
  it("undoes the reset only while it is still the latest change", () => {
    g().place('alb', { kind: 'subnet', refId: 'public-a' });
    const placed = g().board();
    g().resetBoard();
    const undoReset = () => g().toasts.find((t) => t.action?.label === 'Undo')!.action!.run();
    g().place('nat', { kind: 'subnet', refId: 'public-a' });
    const afterNat = g().board();
    undoReset();
    expect(g().board()).toBe(afterNat); // the NAT placement wasn't undone
    g().undo(); // back to the reset (empty) board
    undoReset();
    expect(g().board()).toBe(placed);
  });

  it('clears the surprise result with the rest of the run', () => {
    useGame.setState({ surprise: { ledgerly: { event: ledgerly.events[0], result: { eventId: 'x', status: 'fail', summary: '', lesson: '', manual: [], highlight: [] } } } });
    g().resetBoard();
    expect(g().surprise.ledgerly).toBeUndefined();
  });
});

describe('Fix it', () => {
  it('opens the target on the right tab, remembers the hint, and marks results stale after an edit', () => {
    useGame.setState({ boards: { ledgerly: ledgerly.mistakes.find((m) => m.name === 'App security group open to 0.0.0.0/0')!.board } });
    g().runSim();
    const audit = g().results.ledgerly.find((r) => r.eventId === 'audit')!;
    expect(audit.status).toBe('fail');
    g().followFix({ target: audit.fixTarget!, hint: audit.fixHint!, focus: audit.fixFocus, ruleRef: audit.fixRuleRef }, 'Security audit');
    expect(g().selection).toEqual({ kind: 'sg', id: audit.fixTarget, ruleRef: audit.fixRuleRef });
    expect(g().fixNote?.hint).toBe(audit.fixHint);
    expect(g().resultsBoard.ledgerly).toBe(g().board());
    g().apply((b) => ops.removeSgRule(b, audit.fixTarget!, 'inbound', 1));
    expect(g().resultsBoard.ledgerly).not.toBe(g().board());
    g().runSim();
    expect(g().fixNote).toBeNull();
  });
});

describe('hints', () => {
  it('reveal one at a time, stop at the last, and count as a soft miss on the event concepts', () => {
    const n = ledgerly.hints!.length;
    for (let i = 0; i < n + 2; i++) g().revealHint('audit');
    expect(g().assist().hints).toBe(n);
    const ev = ledgerly.events.find((e) => e.id === 'audit')!;
    const assist = g().conceptEvidence.filter((e) => e.source === 'assist:ledgerly/audit');
    expect(assist.map((e) => e.conceptId).sort()).toEqual([...new Set(ev.concepts)].sort());
    expect(assist.every((e) => !e.correct && e.weight === 0.5)).toBe(true);
    expect(evidenceLabel(assist[0])).toEqual({ kind: 'Asked for help', what: `${ledgerly.title} · ${ev.name}` });
  });

  it('the reference comparison records itself once, with full weight', () => {
    g().openReference({ eventId: 'az-outage' });
    g().openReference(null);
    g().openReference({ eventId: 'az-outage' });
    expect(g().assist().referenceAt).toBeTruthy();
    const ev = g().conceptEvidence.filter((e) => e.source === 'assist:ledgerly/az-outage');
    expect(ev.length).toBe(new Set(ledgerly.events.find((e) => e.id === 'az-outage')!.concepts).size);
    expect(ev.every((e) => e.weight === 1)).toBe(true);
  });

  it('lower mastery: asking for help is evidence of "not yet"', () => {
    const at = '2026-10-01T10:00:00.000Z';
    const right = evidenceFor('question', 'q', ['sg-chaining'], true, at);
    const helped = [...right, ...evidenceFor('assist', 'ledgerly/audit', ['sg-chaining'], false, at)];
    expect(mastery(helped, 'sg-chaining', at).score).toBeLessThan(mastery(right, 'sg-chaining', at).score);
  });

  it('cost an investigation action in incidents', () => {
    g().setMission('inc-door');
    const before = g().incident().actions.length;
    g().revealHint();
    expect(g().incident().actions.length).toBe(before + 1);
    expect(g().incident().actions).toContain('hint:1');
  });
});
