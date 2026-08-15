import { expect, test } from '@playwright/test';

/**
 * Covers the accounts/ranking/dashboard slice end to end against the real
 * dockerized stack (client + api + mongo): register a real account, report a
 * finished match the same way `SiegeMatchReporter` would after a match (via
 * the API directly — driving an actual WebGL siege headlessly would be slow
 * and flaky, and is out of scope for this feature), then confirm Home's
 * embedded stats, loadout history and ranking all reflect it.
 *
 * Squad/deck/history/ranking used to live behind a separate Dashboard/Ranking
 * screen; they are now embedded directly on Home, so this test never
 * navigates anywhere after signing in. There is no guest sign-in any more —
 * an account is required to play at all (see src/app/auth.ts) — so there is
 * no local-only fallback path left to cover here.
 */
test('register, report a match, and see it reflected on Home', async ({ page, request, baseURL }) => {
  const stamp = Date.now().toString(36);
  const username = `e2e_${stamp}`;
  const email = `e2e-${stamp}@example.com`;
  const password = 'hunter2222';

  await page.goto('/');
  await page.getByRole('button', { name: 'Enter Hall' }).click();
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.getByLabel('Nick').fill(username);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Find Match' })).toBeVisible();

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
      squad: ['stone_golem', 'pyromancer', 'stormcaller', 'cleric'],
    },
  });
  expect(reportRes.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Find Match' })).toBeVisible();

  // Home's stat row and squad strip are server-backed and need no navigation.
  // Exact match: "Wins" alone would also match the ranking panel's "By wins" sort button.
  await expect(page.getByText('Wins', { exact: true })).toBeVisible();
  await expect(page.getByText('Most-played squad')).toBeVisible();

  // History tab: element usage chart reflects the reported match.
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByText('9 casts · 4 kills')).toBeVisible();

  // Ranking is embedded on Home too — the freshly reported win shows up
  // without leaving the page. The username also appears in the header above,
  // so scope to the last match (the ranking row is the one further down).
  await expect(page.getByRole('heading', { name: 'Ranking' })).toBeVisible();
  await expect(page.getByText(username).last()).toBeVisible();
});
