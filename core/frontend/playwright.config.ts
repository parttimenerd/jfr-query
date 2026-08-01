import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for W1 — Browser smoke tests.
 *
 * Uses port 5180 (dedicated, avoids collision with :5173 dev and :5175 test
 * servers that may already be running). Always starts a fresh server so tests
 * never pick up a stale or wrong-project vite instance.
 *
 * Workers: 4 parallel workers with fullyParallel=true — each describe.serial
 * block creates its own browser page, so independent suites can run together.
 */
const PORT = 5180;
const BASE_URL = `http://localhost:${PORT}`;
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: IS_CI ? 2 : 4,
  retries: IS_CI ? 2 : 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    // Pre-set localStorage keys that suppress auto-opening overlays (tour, welcome banner,
    // AI nudge) so they never intercept pointer events during tests.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            { name: 'jfr-tour-seen', value: '1' },
            { name: 'jfrq:onboarding-dismissed', value: '1' },
            { name: 'jfrq:ai-nudge-dismissed', value: '1' },
          ],
        },
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
