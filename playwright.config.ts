import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './__tests__/browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1 npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
