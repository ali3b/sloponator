import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'models3d',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 60000,
  },
});
