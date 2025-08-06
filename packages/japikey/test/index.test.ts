import { describe, test, expect } from 'vitest';
import { createApiKey } from '../src/index.ts';

describe('japikey', () => {
  test('index exports', () => {
    expect(createApiKey).toBeDefined();
  });
});
