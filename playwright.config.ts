import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against the dockerized stack (client + api + mongo + gameserver), not
 * the Vite dev server — see `npm run test:e2e` and e2e/README.md. The full
 * stack must already be up at http://localhost:8080 when this runs.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
