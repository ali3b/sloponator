import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'sprites',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
