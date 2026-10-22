import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'render',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
