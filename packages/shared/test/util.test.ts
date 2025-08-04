import { describe, test, expect } from 'vitest';
import { appendPathToUrl } from '../src/util.ts';

describe('appendPathToUrl', () => {
  const testCases = [
    // Basic cases
    {
      base: 'https://example.com',
      path: 'api/v1',
      expected: 'https://example.com/api/v1',
    },
    {
      base: 'https://example.com/',
      path: 'api/v1',
      expected: 'https://example.com/api/v1',
    },
    {
      base: 'https://example.com',
      path: '/api/v1',
      expected: 'https://example.com/api/v1',
    },
    {
      base: 'https://example.com/',
      path: '/api/v1',
      expected: 'https://example.com/api/v1',
    },
    {
      base: 'https://example.com/subpath-without-trailing-slash',
      path: 'api-without-leading-slash/v1',
      expected:
        'https://example.com/subpath-without-trailing-slash/api-without-leading-slash/v1',
    },
    {
      base: 'https://example.com/subpath-without-trailing-slash',
      path: '/api-with-leading-slash/v1',
      expected:
        'https://example.com/subpath-without-trailing-slash/api-with-leading-slash/v1',
    },
    {
      base: 'https://example.com/subpath-with-trailing-slash/',
      path: 'api-without-leading-slash/v1',
      expected:
        'https://example.com/subpath-with-trailing-slash/api-without-leading-slash/v1',
    },
    {
      base: 'https://example.com/subpath-with-trailing-slash/',
      path: '/api-with-leading-slash/v1',
      expected:
        'https://example.com/subpath-with-trailing-slash/api-with-leading-slash/v1',
    },

    // Query parameters and anchors (should be dropped)
    {
      base: 'https://example.com?param=value',
      path: 'api/v1',
      expected: 'https://example.com/api/v1',
    },
    {
      base: 'https://example.com#anchor',
      path: 'api/v1',
      expected: 'https://example.com/api/v1',
    },
    {
      base: 'https://example.com?param=value#anchor',
      path: 'api/v1',
      expected: 'https://example.com/api/v1',
    },

    // Username and password (should be preserved)
    {
      base: 'https://user:pass@example.com',
      path: 'api/v1',
      expected: 'https://user:pass@example.com/api/v1',
    },
    {
      base: 'https://user:pass@example.com/',
      path: 'api/v1',
      expected: 'https://user:pass@example.com/api/v1',
    },
    {
      base: 'https://user:pass@example.com?param=value',
      path: 'api/v1',
      expected: 'https://user:pass@example.com/api/v1',
    },

    // Port numbers
    {
      base: 'https://example.com:8080',
      path: 'api/v1',
      expected: 'https://example.com:8080/api/v1',
    },
    {
      base: 'https://user:pass@example.com:8080',
      path: 'api/v1',
      expected: 'https://user:pass@example.com:8080/api/v1',
    },

    // Complex paths
    {
      base: 'https://example.com',
      path: 'api/v1/users/123',
      expected: 'https://example.com/api/v1/users/123',
    },
    {
      base: 'https://example.com/',
      path: '/api/v1/users/123',
      expected: 'https://example.com/api/v1/users/123',
    },

    // Empty path
    {
      base: 'https://example.com',
      path: '',
      expected: 'https://example.com/',
    },
    {
      base: 'https://example.com/',
      path: '',
      expected: 'https://example.com/',
    },

    // Root path
    {
      base: 'https://example.com',
      path: '/',
      expected: 'https://example.com/',
    },
    {
      base: 'https://example.com/',
      path: '/',
      expected: 'https://example.com/',
    },
  ];

  test.each(testCases)(
    'should append path "$path" to base "$base"',
    ({ base, path, expected }) => {
      const baseUrl = new URL(base);
      const result = appendPathToUrl(baseUrl, path);
      expect(result.toString()).toBe(expected);
    }
  );
});
