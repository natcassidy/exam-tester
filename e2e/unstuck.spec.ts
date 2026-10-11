// Replays the stuck moments players hit and checks the app gets them out, counting the clicks.

import { expect, test, type Page } from '@playwright/test';
import type { Board } from '../src/engine/model';
import { attachSecurityGroups } from '../src/engine/board';
import { ledgerly } from '../src/content/missions/ledgerly';

/** Load the app with a saved game: Ledgerly open, the tour done, and the given board. */
async function openWith(page: Page, board?: Board) {
  const state = {
    schemaVersion: 4,
    currentMissionId: 'ledgerly',
    boards: board ? { ledgerly: board } : {},
    best: {},
    questionHistory: [],
    conceptEvidence: [],
    settings: { reducedMotion: true },
    incidents: {},
    diffAnswers: {},
    daily: {},
    defends: {},
    exams: [],
    tutorial: { done: true, step: 0 },
    assists: {},
  };
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('blast-radius', JSON.stringify({ state: s, version: 4 }));
      sessionStorage.setItem('seeded', '1');
    }
  }, state);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Run simulation/ })).toBeVisible();
}

/** The board from the bug report: the load balancer's security group attached to the app tier. */
function borrowedSgBoard(): Board {
  const ref = ledgerly.reference;
  const byName = (n: string) => Object.values(ref.components).find((c) => c.name === n)!;
  const asg = byName('app-asg');
  const r = attachSecurityGroups(ref, asg.id, [...asg.securityGroupIds!, byName('web-alb').securityGroupIds![0]]);
  if (!r.ok) throw new Error(r.error);
  return r.board;
}

test('alb-sg on the app tier: the audit says what to untick, and Fix it lands on the checkbox', async ({ page }) => {
  await openWith(page, borrowedSgBoard());
  let clicks = 0;
  const click = async (l: ReturnType<Page['locator']>) => {
    clicks++;
    await l.click();
  };

  // The board already flags the borrowed group before anything runs.
  await expect(page.locator('.sg-chip.borrowed', { hasText: 'alb-sg' })).toBeVisible();
  await expect(page.locator('.board-toolbar .live.bad')).toContainText('1 security issue');

  await click(page.getByRole('button', { name: /Run simulation/ }));
  const audit = page.locator('#result-audit');
  await expect(page.locator('.failing-chips')).toContainText('Security audit');
  await expect(audit.locator('.how-to-fix')).toContainText('untick alb-sg under "Security groups attached"');
  // Failures come first, at full width.
  await expect(page.locator('.drawer-body > .result').first()).toHaveAttribute('id', 'result-audit');

  await click(audit.locator('.how-to-fix').getByRole('button', { name: 'Fix it' }));
  const panel = page.locator('.col.right');
  await expect(panel.getByRole('tab', { name: 'Networking', selected: true })).toBeVisible();
  await expect(panel.locator('.fix-banner')).toContainText('untick alb-sg');
  await expect(panel.locator('.section.focus-pulse h4')).toHaveText('Security groups attached');
  await expect(panel.locator('label.field.borrowed')).toContainText("This is web-alb's group");

  await click(panel.getByRole('checkbox', { name: /^alb-sg/ }));
  await expect(page.locator('.stale-banner')).toBeVisible();
  await expect(page.locator('.board-toolbar .live.ok')).toBeVisible();

  await click(page.locator('.stale-banner').getByRole('button', { name: 'Run again' }));
  await expect(page.locator('#result-audit .tag.pass')).toBeVisible();
  await expect(page.locator('.failing-chips')).toHaveCount(0);
  expect(clicks).toBeLessThanOrEqual(4);
});

test('Stuck? reveals hints one at a time, then the reference comparison', async ({ page }) => {
  await openWith(page, ledgerly.mistakes.find((m) => m.name === 'Single-AZ database')!.board);
  await page.getByRole('button', { name: /Run simulation/ }).click();
  const card = page.locator('#result-az-outage');
  await card.getByRole('button', { name: 'Stuck?' }).click();
  const n = ledgerly.hints!.length;
  for (let i = 1; i <= n; i++) {
    await card.getByRole('button', { name: new RegExp(`hint \\(${i} of ${n}\\)`) }).click();
    await expect(card.locator('.hints li')).toHaveCount(i);
  }
  await card.getByRole('button', { name: 'Compare with the reference design' }).click();
  const modal = page.getByRole('dialog', { name: 'Reference design' });
  // The differences about the failing check come first.
  await expect(modal.locator('.reference-diffs > ul > li').first()).toContainText('multi az: the reference uses on, yours is off');
  await expect(modal.locator('.reference-diffs > ul > li').first().getByRole('button', { name: /Open on my board/ })).toBeVisible();
  await modal.locator('.reference-board .node').first().click();
  await expect(modal.locator('.reference-inspect table')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  // Hints are remembered for the mission: the brief shows them too.
  await expect(page.locator('.col.right .stuck .hints li')).toHaveCount(n);
});

test('an empty board: checks with nothing to test stay collapsed, and the brief offers hints', async ({ page }) => {
  await openWith(page);
  await page.getByRole('button', { name: /Run simulation/ }).click();
  await expect(page.locator('.drawer-body > article.result')).toHaveCount(0);
  await expect(page.locator('.drawer-body > button.result.compact.fail').first()).toContainText('Nothing to test');
  await expect(page.locator('.board-toolbar .live')).toHaveCount(0); // no "checks pass" on an empty board
  await expect(page.locator('.col.right .stuck').getByRole('button', { name: /Show a hint/ })).toBeVisible();
});

test('undo and redo a placement, with the keyboard and the toolbar', async ({ page }) => {
  await openWith(page);
  await page.getByRole('button', { name: /^Place Application LB/ }).click();
  await page.getByLabel('Subnet public-a').click();
  await expect(page.locator('.board .node[data-node-id]', { hasText: 'web-alb' })).toHaveCount(1);
  await page.locator('.board').click({ position: { x: 5, y: 60 } }); // move focus off any field
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.board .node[data-node-id]', { hasText: 'web-alb' })).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.board .node[data-node-id]', { hasText: 'web-alb' })).toHaveCount(1);
  await page.locator('.board-toolbar').getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('.board .node[data-node-id]', { hasText: 'web-alb' })).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.board .node[data-node-id]', { hasText: 'web-alb' })).toHaveCount(1);
});

test('Security view draws the chain and marks the open path in red', async ({ page }) => {
  await openWith(page, borrowedSgBoard());
  await page.getByRole('button', { name: 'Security view' }).click();
  await expect(page.locator('.sg-overlay path[marker-end="url(#sg-arrow-open)"]')).toHaveCount(1);
  await expect(page.locator('.sg-overlay text', { hasText: 'from 0.0.0.0/0' })).toBeVisible();
  expect(await page.locator('.sg-overlay path[marker-end="url(#sg-arrow)"]').count()).toBeGreaterThanOrEqual(2);
});
