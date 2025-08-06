import { defineConfig, TestProjectInlineConfiguration } from 'vitest/config';
import { resolve } from 'path';

const getProjectConfig = (name: string): TestProjectInlineConfiguration => {
  return {
    extends: true,
    test: {
      include: [`packages/${name}/test/**/*.test.ts`],
      globals: true,
      environment: 'node',
    },
    resolve: {
      alias: {
        '@japikey/shared': resolve(__dirname, './packages/shared/src/index.ts'),
        '@japikey/japikey': resolve(
          __dirname,
          './packages/japikey/src/index.ts'
        ),
        '@japikey/authenticate': resolve(
          __dirname,
          './packages/authenticate/src/index.ts'
        ),
        '@japikey/sqlite': resolve(__dirname, './packages/sqlite/src/index.ts'),
      },
    },
  };
};

const japikeyConfig = getProjectConfig('japikey');
japikeyConfig.test!.setupFiles = [
  './packages/japikey/test/setupFiles/mockJose.ts',
];

export default defineConfig({
  test: {
    projects: [
      japikeyConfig,
      getProjectConfig('shared'),
      getProjectConfig('authenticate'),
      getProjectConfig('express'),
      getProjectConfig('cloudflare'),
      getProjectConfig('sqlite'),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        '**/node_modules/',
        '**/dist/',
        '**/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/',
        '**/d1.ts', // Requires an actual D1 database to test properly, out of scope for now
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
