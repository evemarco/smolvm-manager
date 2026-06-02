import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000'
  },
  webServer: {
    command:
      'rm -f ./data/e2e-test.db && PYLON_AUTH_MOCK=true DATABASE_URL=sqlite://./data/e2e-test.db bun --bun run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
});
