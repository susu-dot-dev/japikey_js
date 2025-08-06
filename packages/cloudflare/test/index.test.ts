import { describe, test, expect } from 'vitest';
import {
  createApiKeyRouter,
  createJWKSRouter,
  D1Driver,
} from '../src/index.ts';

describe('index', () => {
  test('should export the correct things', () => {
    expect(createApiKeyRouter).toBeDefined();
    expect(createJWKSRouter).toBeDefined();
    expect(D1Driver).toBeDefined();
  });
});
