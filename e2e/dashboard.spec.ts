import { expect, test } from '@playwright/test';

/**
 * Covers the accounts/ranking/dashboard slice end to end against the real
 * dockerized stack (client + api + mongo): register a real account, report a
 * finished match the same way `MatchReporter` would after a SP-vs-AI round
 * (via the API directly — driving an actual WebGL duel headlessly would be
 * slow and flaky, and is out of scope for this feature), then confirm the
 * dashboard, element-usage chart and global ranking all reflect it.
 * See docs/accounts-ranking-dashboard.md.
 */
test('register, report a match, and see it on the dashboard and ranking', async ({ page, request, baseURL }) => {
  const stamp = Date.now().toString(36);
  const username = `e2e_${stamp}`;
  const email = `e2e-${stamp}@example.com`;
  const password = 'hunter2222';

  await page.goto('/');
  await page.getByRole('button', { name: 'Enter Hall' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByLabel('Mage name').fill(username);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create & enter' }).click();

  await expect(page.getByRole('heading', { name: 'Hall of the Acolyte' })).toBeVisible();

  const token = await page.evaluate(() => {
    const raw = localStorage.getItem('mage-craft.session.v1');
    return raw ? (JSON.parse(raw) as { token?: string }).token : undefined;
  });
  expect(token).toBeTruthy();

  const reportRes = await request.post(`${baseURL}/api/matches`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      mode: 'sp-vs-ai',
      won: true,
      kills: 4,
      deaths: 1,
      score: 250,
      difficulty: 'normal',
      timeSeconds: 70,
      livesSpent: 1,
      map: 'arena1.json',
      elements: [{ elementId: 'fire', casts: 9, hits: 5, kills: 4, damageDealt: 150 }],
    },
  });
  expect(reportRes.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hall of the Acolyte' })).toBeVisible();

  // Dashboard: server-backed stats, recent match, element usage chart.
  await expect(page.getByText('Victory · sp-vs-ai')).toBeVisible();
  await expect(page.getByText('4 kills · 1 deaths · arena1.json')).toBeVisible();
  await expect(page.getByText('9 casts · 4 kills')).toBeVisible();

  // Ranking: the freshly reported win should show this player.
  await page.getByRole('button', { name: 'Ranking' }).click();
  await expect(page.getByRole('heading', { name: 'Ranking' })).toBeVisible();
  await expect(page.getByText(username)).toBeVisible();
});

test('guest play stays fully local (no account, no server stats section)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter Hall' }).click();
  await page.getByLabel('Mage name').fill('Guest Tester');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Hall of the Acolyte' })).toBeVisible();
  await expect(page.getByText('Playing as guest')).toBeVisible();
  await expect(page.getByText('Skills used')).toHaveCount(0);
});
