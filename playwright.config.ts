import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100'
  },
  webServer: {
    command:
      'rm -f ./data/e2e-test.db && PYLON_AUTH_MOCK=true PYLON_STORE_MOCK=true DATABASE_URL=sqlite://./data/e2e-test.db bun --bun x vite dev --host 0.0.0.0 --port 3100 --strictPort',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 120000
  }
});
