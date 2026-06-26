import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for W1 — Browser smoke tests.
 *
 * Boots the Vite dev server on a dedicated test port (5173) to avoid
 * colliding with any pre-existing service on the app's default :3000.
 * Single chromium project; serial execution (the dev server is single-tenant).
 */
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: IS_CI ? 2 : 0,
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
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
