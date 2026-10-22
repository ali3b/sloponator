import { defineConfig } from '@playwright/test';

// Browser tests (the render runner from P2 on, the UI from P9). `npm run test:e2e`; CI runs them once there are some.
export default defineConfig({
  testDir: 'packages',
  testMatch: '**/e2e/**/*.e2e.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
