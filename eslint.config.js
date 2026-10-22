// Minimal rules: the recommended sets, plus the few that catch real mistakes in a strict ESM codebase.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // spikes/ holds P0 throwaway scripts (browser code inside page.evaluate); they are not linted.
  { ignores: ['**/node_modules/**', '**/dist/**', '**/test-results/**', 'spikes/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', fetch: 'readonly', performance: 'readonly' } },
    rules: { 'no-empty': ['error', { allowEmptyCatch: true }], '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }] },
  },
);
