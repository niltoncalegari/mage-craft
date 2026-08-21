import { defineConfig, devices } from '@playwright/test';

/**
 * Three suites with different needs, so three projects.
 *
 * `accounts` covers the accounts/ranking/dashboard slice against the
 * dockerized stack (client + api + mongo + gameserver) — see `npm run
 * test:e2e` and e2e/README.md. The full stack must already be up at
 * http://localhost:8080 when it runs.
 *
 * `mobile-hud` and `desktop-shell` measure layout — where the in-match HUD sits
 * on a landscape phone, and whether the menu shell uses a desktop window. Both
 * are CSS geometry against locally simulated screens, so they need none of the
 * backends and run against the Vite dev server, which the `webServer` block
 * below starts (or reuses, if one is already running).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  /*
   * One worker, and a generous per-test budget. Two of the three suites drive a
   * real WebGL siege in the page; run two of those at once on one machine and
   * the shader compile alone can eat a 30s test timeout before the first
   * assertion, which reads as a layout failure and is not one.
   */
  workers: 1,
  timeout: 90_000,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'accounts',
      testMatch: /dashboard\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:8080' },
    },
    {
      name: 'desktop-shell',
      testMatch: /desktopShell\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1512, height: 945 },
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'mobile-hud',
      testMatch: /mobileHud\.spec\.ts/,
      use: {
        ...devices['iPhone 15 Pro landscape'],
        // The device descriptor asks for WebKit; Chromium honours its viewport,
        // touch and user agent all the same, and is what CI already installs.
        defaultBrowserType: 'chromium',
        baseURL: 'http://localhost:5173',
      },
    },
  ],
});
