import { describe, test, expect } from 'vitest';
import { cloudflareIntegration } from '../src/index.ts';

describe('cloudflareIntegration', () => {
  test('returns expected string', () => {
    const result = cloudflareIntegration();
    expect(result).toBe('cloudflare-integration-stub');
  });
});
