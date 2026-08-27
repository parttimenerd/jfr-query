import { defineConfig, devices } from '@playwright/test';

const PORT = 4244;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/jvmlog-server.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  reporter: [['list']],
  globalSetup: './e2e/support/jvmlog-global-setup.ts',
  globalTeardown: './e2e/support/jvmlog-global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
