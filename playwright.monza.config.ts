import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'monza-standalone.spec.ts',
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175/monza.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
