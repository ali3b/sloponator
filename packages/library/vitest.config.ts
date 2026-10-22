import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'library',
    include: ['test/**/*.test.ts'],
  },
});
