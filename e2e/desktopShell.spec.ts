import { expect, test, type Page } from '@playwright/test';

/**
 * The menu shell on a desktop.
 *
 * Same harness as mobileHud.spec.ts — Vite dev server, a faked session, every
 * `/api/**` failed with a 502 so `restoreSession` keeps it (see src/app/auth.ts)
 * — but the opposite question. Home is one long column of stacked sections,
 * which is the right shape for a phone and the wrong one for a 1512px window:
 * capped at 920px it left ~40% of the screen as empty background on either side
 * and pushed the ranking a full scroll below the squad builder.
 *
 * These assertions are about proportion and adjacency, not pixels, so a
 * different desktop layout is free to pass them differently.
 */

/** Below this the single-column layout is correct and these rules do not apply. */
const DESKTOP_MIN = 1180;

async function openHome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mage-craft.session.v1',
      JSON.stringify({
        id: 'e2e-desktop',
        name: 'DevMage',
        createdAt: Date.now(),
        wins: 0,
        losses: 0,
        favoriteElement: 'fire',
        title: '',
        token: 'e2e-token',
        email: 'e2e@example.com',
      }),
    );
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 502, body: '{}' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DevMage' })).toBeVisible({ timeout: 30_000 });
}

test.describe('the menu shell on a desktop window', () => {
  test.beforeEach(async ({ page }) => {
    await openHome(page);
  });

  test('uses the width of the window instead of a phone column', async ({ page }) => {
    const width = page.viewportSize()!.width;
    expect(width, 'this spec only describes desktop widths').toBeGreaterThanOrEqual(DESKTOP_MIN);

    const home = await page.getByTestId('home-panel').boundingBox();
    expect(home).not.toBeNull();
    // Not "full bleed" — a reading measure still applies — but a desktop window
    // should be mostly page, not mostly background.
    expect(home!.width / width).toBeGreaterThan(0.8);
  });

  test('puts the ranking beside the loadout, not a scroll below it', async ({ page }) => {
    const loadout = await page.getByTestId('home-loadout').boundingBox();
    const ranking = await page.getByTestId('home-ranking').boundingBox();
    expect(loadout).not.toBeNull();
    expect(ranking).not.toBeNull();

    // Side by side: the rail starts to the right of where the loadout ends...
    expect
      .soft(ranking!.x, 'ranking sits right of the loadout')
      .toBeGreaterThanOrEqual(loadout!.x + loadout!.width - 1);
    // ...and on the same band of the page, rather than under it.
    expect
      .soft(ranking!.y, 'ranking shares a row with the loadout')
      .toBeLessThan(loadout!.y + loadout!.height);
  });

  test('gives the roster grid more than a phone number of columns', async ({ page }) => {
    const cards = await page.getByTestId('roster-card').all();
    expect(cards.length).toBeGreaterThan(4);

    const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
    const topRow = boxes.filter((box) => box!.y === boxes[0]!.y);
    expect(topRow.length, 'roster fits at least four across on a desktop').toBeGreaterThanOrEqual(
      4,
    );
  });
});
