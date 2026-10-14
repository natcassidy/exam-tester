// Course Labs: pick a course section from the mission index, open a pre-built lab, fix it and restore the starting board.

import { expect, test } from '@playwright/test';

test('course labs: pick a lab from the index, start from the handed-over board, restore it', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('blast-radius', JSON.stringify({ state: { schemaVersion: 4, settings: { reducedMotion: true }, tutorial: { done: true, step: 0 } }, version: 4 }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/');
  await page.getByRole('tab', { name: /Course Labs/ }).click();

  // Every section is listed in the index, with its labs; sections without labs say why.
  await page.getByRole('button', { name: /Course section \d+/ }).click();
  const index = page.getByRole('dialog', { name: 'All missions' });
  await expect(index.getByRole('tab', { name: /Course Labs/ })).toHaveAttribute('aria-selected', 'true');
  await expect(index.getByRole('region', { name: '18. Containers on AWS' })).toContainText('not modelled');
  await index.getByRole('region', { name: '27. Networking: VPC' }).getByRole('button', { name: /A VPC from scratch/ }).click();
  await expect(index).toBeHidden();

  const chips = page.getByRole('navigation', { name: 'Missions' });
  await expect(chips.getByRole('button', { name: /Course section 27: Networking: VPC/ })).toBeVisible();
  await expect(chips.getByRole('button', { name: /A VPC from scratch/ })).toHaveAttribute('aria-current', 'true');
  await expect(chips.getByRole('button', { name: /Peered, but silent/ })).toBeVisible();

  await chips.getByRole('button', { name: /Stateless means both ways/ }).click();
  const brief = page.locator('.brief');
  await expect(brief).toContainText('Course section 27: Networking: VPC');
  await expect(brief).toContainText('Fix it');
  await expect(brief).toContainText('NACL & Security Groups');

  // The lab starts from its broken board, which fails the shopper's request.
  await page.getByRole('button', { name: /Run simulation/ }).click();
  await expect(brief.locator('.req .mark.missed').first()).toBeVisible();
  await expect(brief.getByRole('button', { name: 'Restore the starting board' })).toBeVisible();
});

test('mission index: every mode lists all its missions, search jumps across modes, section arrows step', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('blast-radius', JSON.stringify({ state: { schemaVersion: 4, settings: { reducedMotion: true }, tutorial: { done: true, step: 0 }, best: { 'c-iam-role': { stars: 3, points: 100, at: '2026-10-01T00:00:00Z' } } }, version: 4 }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/');
  const chips = page.getByRole('navigation', { name: 'Missions' });
  await chips.getByRole('button', { name: /^All/ }).click();
  const index = page.getByRole('dialog', { name: 'All missions' });
  await expect(index.getByRole('tab', { name: /^Build/ })).toHaveAttribute('aria-selected', 'true');
  await expect(index.locator('.index-row')).toHaveCount(12);

  await index.getByRole('tab', { name: /Incidents/ }).click();
  await expect(index.locator('.index-row')).toHaveCount(8);
  await expect(index.getByRole('tab', { name: /Course Labs/ })).toContainText('1/37');
  await index.getByRole('tab', { name: /Course Labs/ }).click();
  await expect(index.locator('.index-row')).toHaveCount(37);
  await expect(index.getByRole('region', { name: '4. IAM and the AWS CLI' })).toContainText('1/2 done');
  await index.getByLabel('Hide sections without labs').check();
  await expect(index.locator('.index-group.empty')).toHaveCount(0);

  // Search runs across every mode.
  await index.getByRole('searchbox', { name: 'Search missions' }).fill('ledgerly');
  await expect(index.getByRole('region', { name: 'Incidents' })).toBeVisible();
  await index.getByRole('button', { name: /The wrong door/ }).click();
  await expect(index).toBeHidden();
  await expect(page.getByRole('tab', { name: /Incidents/ })).toHaveAttribute('aria-selected', 'true');
  await expect(chips.getByRole('button', { name: /The wrong door/ })).toHaveAttribute('aria-current', 'true');

  // Course Labs: the arrows step between sections that have labs.
  await page.getByRole('tab', { name: /Course Labs/ }).click();
  await expect(chips.getByRole('button', { name: /Course section 4:/ })).toBeVisible();
  await expect(chips.getByRole('button', { name: 'Previous course section' })).toBeDisabled();
  await chips.getByRole('button', { name: 'Next course section' }).click();
  await expect(chips.getByRole('button', { name: /Course section 5:/ })).toBeVisible();
  await page.keyboard.press('Escape');

  // Escape closes the index.
  await chips.getByRole('button', { name: /^All/ }).click();
  await expect(index).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(index).toBeHidden();
});

test('A VPC from scratch: make a subnet public from its route table, then place the NAT gateway', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('blast-radius', JSON.stringify({ state: { schemaVersion: 4, currentMissionId: 'c-vpc-build', settings: { reducedMotion: true }, tutorial: { done: true, step: 0 } }, version: 4 }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/');
  const nodes = page.locator('.board .node[data-node-id]');
  // The servers the brief talks about are already on the board.
  await expect(nodes.filter({ hasText: 'web' })).toHaveCount(1);
  await expect(nodes.filter({ hasText: 'worker' })).toHaveCount(1);
  await expect(page.getByLabel('Subnet public-a')).toContainText('click the name to edit routes');

  await page.getByRole('button', { name: /^Place Internet gateway/ }).click();
  await page.getByLabel('Attachments of scratch').click();
  await expect(nodes.filter({ hasText: /igw/ })).toHaveCount(1);

  // Clicking the subnet name opens its route table; one route makes it public.
  await page.locator('.subnet-head', { hasText: 'public-a' }).click();
  await page.getByRole('button', { name: 'Add route' }).click();
  await expect(page.locator('.subnet-head', { hasText: 'public-a' }).locator('.tag.public')).toBeVisible();

  await page.getByRole('button', { name: /^Place NAT gateway/ }).click();
  await page.getByLabel('Subnet public-a').click();
  await expect(nodes.filter({ hasText: /nat/i })).toHaveCount(1);
});
