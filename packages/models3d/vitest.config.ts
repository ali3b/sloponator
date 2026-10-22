import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'models3d',
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
  },
});
