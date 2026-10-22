import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'formats',
    include: ['test/**/*.test.ts'],
  },
});
