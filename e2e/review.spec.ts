// Easy and hard palettes, and the end-of-mission solution review.

import { expect, test, type Page } from '@playwright/test';
import type { Board } from '../src/engine/model';
import { MISSION_BY_ID } from '../src/content/missions';

const ledgerly = MISSION_BY_ID.ledgerly;

async function openWith(page: Page, board?: Board, difficulty?: 'easy' | 'hard') {
  const state = {
    schemaVersion: 4,
    currentMissionId: 'ledgerly',
    boards: board ? { ledgerly: board } : {},
    best: {},
    questionHistory: [],
    conceptEvidence: [],
    settings: { reducedMotion: true, ...(difficulty ? { difficulty } : {}) },
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

const palette = (page: Page) => page.locator('.palette[aria-label="Services"]');

test('hard mode mixes extra services into the palette and hides the signal phrases', async ({ page }) => {
  await openWith(page);
  await expect(palette(page).getByRole('button', { name: /^Place Aurora cluster/ })).toHaveCount(0);
  await expect(page.locator('.brief')).toContainText('Multi-AZ');

  await page.locator('.brief').getByRole('radio', { name: 'Hard' }).click();
  await expect(palette(page).locator('.tag', { hasText: 'HARD' })).toBeVisible();
  await expect(palette(page).getByRole('button', { name: /^Place Aurora cluster/ })).toBeVisible();
  await expect(palette(page).getByRole('button', { name: /^Place SQS queue/ })).toBeVisible();
  await expect(page.locator('.brief')).toContainText('Hidden in hard mode until your first run');

  await page.locator('.brief').getByRole('radio', { name: 'Easy' }).click();
  await expect(palette(page).getByRole('button', { name: /^Place Aurora cluster/ })).toHaveCount(0);
});

test('a solved mission offers the solution review, decision by decision', async ({ page }) => {
  await openWith(page, ledgerly.reference, 'hard');
  await page.getByRole('button', { name: /Run simulation/ }).click();
  // Three stars in hard mode earn the mission chip an H.
  await expect(page.locator('.chip.active .hard-badge')).toBeVisible();
  await page.locator('.review-cta').getByRole('button', { name: 'Open the solution review' }).click();
  const review = page.getByRole('dialog', { name: 'Solution review' });
  await expect(review.locator('.decision')).toHaveCount(ledgerly.decisions!.length);
  await expect(review.locator('.decision.covered')).toHaveCount(ledgerly.decisions!.length);
  await expect(review).toContainText('Why it matters');
  await review.locator('summary', { hasText: "Services on offer that this design doesn't need" }).click();
  await expect(review.locator('.why-not')).toContainText('Aurora would also pass');
  await review.getByRole('tab', { name: 'Side by side' }).click();
  await expect(review.locator('.diff-side')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/review-boards.png' });
  await page.keyboard.press('Escape');
  await expect(review).toHaveCount(0);
});

test('a failing design shows which decisions it misses and how it differs', async ({ page }) => {
  const oneNat = ledgerly.mistakes.find((m) => m.name === 'Single NAT gateway for both AZs')!.board;
  await openWith(page, oneNat);
  await page.getByRole('button', { name: /Run simulation/ }).click();
  await page.getByRole('button', { name: /See the solution/ }).click();
  const review = page.getByRole('dialog', { name: 'Solution review' });
  const nat = review.locator('.decision', { hasText: 'One NAT gateway per AZ' });
  await expect(nat).toHaveClass(/missed/);
  await expect(nat).toContainText('us-east-1a goes dark');
  await expect(nat).toContainText('The reference has nat-b');
  // The AZ outage fails because of the NAT, not the database: that decision matches the reference.
  await expect(review.locator('.decision', { hasText: 'Multi-AZ RDS' })).toContainText('Same as the reference');
  await page.screenshot({ path: 'test-results/review-decisions.png' });
  await review.getByRole('tab', { name: 'Side by side' }).click();
  await expect(review.locator('.node.mark-missing')).toContainText('nat-b');
});

test('the solution review fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWith(page, ledgerly.reference);
  await page.getByRole('button', { name: /Run simulation/ }).click();
  await page.getByRole('button', { name: 'Open the solution review' }).click();
  const review = page.getByRole('dialog', { name: 'Solution review' });
  await expect(review.locator('.decision').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/review-phone.png' });
});
