import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const browserOnly = [
  'window',
  'document',
  'navigator',
  'indexedDB',
  'localStorage',
  'sessionStorage',
  'Worker',
  'fetch',
  'self',
  'requestAnimationFrame',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.pio/**',
      'firmware/**',
      'tools/**',
      'apps/**',
      // the frontend developer's standalone app has its own toolchain
      'fedfront/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    // The engine is pure: no DOM, no Bluetooth, no storage, no workers.
    files: [
      'packages/engine/src/**/*.ts',
      'packages/protocol/src/**/*.ts',
      'packages/simulator/src/**/*.ts',
    ],
    rules: {
      'no-restricted-globals': ['error', ...browserOnly],
      'no-restricted-imports': [
        'error',
        { patterns: ['dexie', '@force/storage', '@force/device', '@force/worker'] },
      ],
    },
  },
  {
    files: ['packages/*/test/**/*.ts', 'packages/*/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
