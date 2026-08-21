import { expect, test, type Page } from '@playwright/test';

/**
 * The in-match HUD on a phone held in landscape.
 *
 * This is the one gameplay-driven spec in the suite, and it runs against the
 * Vite dev server rather than the dockerized stack (see playwright.config.ts):
 * what it measures is CSS geometry, so it needs no account service, no game
 * server and no Mongo — Practice runs the real siege locally. The session is
 * faked into localStorage and every `/api/**` call is failed with a 502, which
 * `restoreSession` (src/app/auth.ts) deliberately treats as "API unreachable,
 * keep the stored session" rather than as a sign-out.
 *
 * What it guards is the thing that actually broke: at 852x393 the two squad
 * dashboards were 210px wide each — 49% of the viewport, sitting directly on
 * top of both lanes and both Towers. The assertions below are about where the
 * HUD is allowed to be, not about how it looks, so a redesign that keeps the
 * arena readable is free to change everything else.
 */

/** Everything between these two fractions of the viewport height is the board. */
const PLAY_BAND_TOP = 0.22;
const PLAY_BAND_BOTTOM = 0.72;

/** Apple HIG's floor for a fingertip, and the one the menu shell already uses. */
const MIN_TOUCH = 44;

async function startPractice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mage-craft.session.v1',
      JSON.stringify({
        id: 'e2e-mobile',
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
  // Not 401: that one clears the session and drops the shell back to the title.
  await page.route('**/api/**', (route) => route.fulfill({ status: 502, body: '{}' }));

  await page.goto('/');
  await page.getByRole('button', { name: /^Practice/ }).click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  // Generous: this boots a real WebGL siege, and a cold shader compile on a
  // loaded CI box has run past the default 5s.
  await expect(page.getByTestId('match-top')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('squad-panel').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('in-match HUD on a landscape phone', () => {
  test.beforeEach(async ({ page }) => {
    await startPractice(page);
  });

  test('leaves the middle of the arena clear', async ({ page }) => {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const { width, height } = viewport!;

    const bandTop = height * PLAY_BAND_TOP;
    const bandBottom = height * PLAY_BAND_BOTTOM;

    for (const panel of await page.getByTestId('squad-panel').all()) {
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      // Every dashboard sits wholly below the play band — no lane is covered.
      expect
        .soft(box!.y, 'squad panel starts below the play band')
        .toBeGreaterThanOrEqual(bandBottom);
      expect
        .soft(box!.y + box!.height, 'squad panel stays on screen')
        .toBeLessThanOrEqual(height + 1);
    }

    const top = await page.getByTestId('match-top').boundingBox();
    expect(top).not.toBeNull();
    expect
      .soft(top!.y + top!.height, 'top bar stays above the play band')
      .toBeLessThanOrEqual(bandTop);

    const bar = await page.getByTestId('match-bar').boundingBox();
    expect(bar).not.toBeNull();
    expect.soft(bar!.y, 'trace line stays below the play band').toBeGreaterThanOrEqual(bandBottom);
    void width;
  });

  test('never lets two HUD surfaces overlap each other', async ({ page }) => {
    const boxes = await Promise.all(
      [
        ...(await page.getByTestId('squad-panel').all()),
        page.getByTestId('match-top'),
        page.getByTestId('match-bar'),
      ].map((l) => l.boundingBox()),
    );

    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const overlaps =
          a!.x < b!.x + b!.width &&
          b!.x < a!.x + a!.width &&
          a!.y < b!.y + b!.height &&
          b!.y < a!.y + a!.height;
        expect
          .soft(overlaps, `HUD surfaces ${i} and ${boxes.indexOf(b)} must not overlap`)
          .toBe(false);
      }
    }
  });

  test('keeps every in-match control thumb-sized', async ({ page }) => {
    const panel = page.getByTestId('squad-panel').first();
    for (const control of await panel.getByRole('button').all()) {
      const box = await control.boundingBox();
      if (!box) continue; // A dead mage's row can be hidden.
      expect
        .soft(box.height, `control is at least ${MIN_TOUCH}px tall`)
        .toBeGreaterThanOrEqual(MIN_TOUCH);
    }
  });
});
