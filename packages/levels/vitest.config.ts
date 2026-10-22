import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'levels',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
