import { describe, test, expect } from 'vitest';
import { createApiKeyRouter, createJWKSRouter } from '../src/index.ts';

describe('index', () => {
  test('should export the correct things', () => {
    expect(createApiKeyRouter).toBeDefined();
    expect(createJWKSRouter).toBeDefined();
  });
});
