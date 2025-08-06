import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

function createConfig(extraGlobals) {
  return {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2024,
        sourceType: 'module',
      },
      globals: {
        ...extraGlobals,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-unused-vars': 'off',
    },
  };
}

const ignores = {
  ignores: ['**/dist/**', 'node_modules/', '*.js'],
};

export const browserConfig = [
  js.configs.recommended,
  createConfig(globals.browser),
  ignores,
];
export const nodeConfig = [
  js.configs.recommended,
  createConfig(globals.node),
  ignores,
];

export default nodeConfig;
