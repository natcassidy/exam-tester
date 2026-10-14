// Course Labs: pick a course section, open a pre-built lab, fix it and restore the starting board.

import { expect, test } from '@playwright/test';

test('course labs: pick a section, start from the handed-over board, restore it', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('blast-radius', JSON.stringify({ state: { schemaVersion: 4, settings: { reducedMotion: true }, tutorial: { done: true, step: 0 } }, version: 4 }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/');
  await page.getByRole('tab', { name: /Course Labs/ }).click();

  const picker = page.getByRole('combobox', { name: 'Course section' });
  await expect(picker).toBeVisible();
  // Sections without labs are listed but can't be picked.
  await expect(picker.locator('option', { hasText: 'Containers on AWS' })).toBeDisabled();

  await picker.selectOption({ label: '27. Networking: VPC (0/3)' });
  const chips = page.getByRole('navigation', { name: 'Missions' });
  await expect(chips.getByRole('button', { name: /A VPC from scratch/ })).toBeVisible();
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
