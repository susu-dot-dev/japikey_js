import { describe, test, expect } from 'vitest';
import { createApiKey, SqliteDriver } from '../src/index.ts';

describe('japikey', () => {
  test('index exports', () => {
    expect(createApiKey).toBeDefined();
    expect(SqliteDriver).toBeDefined();
  });
});
