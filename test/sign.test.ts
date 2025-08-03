import { describe, it, expect } from 'vitest';
import * as jose from 'jose';
import { createApiKey } from '../src/sign';

describe('createApiKey', () => {
  it('should create a valid API key', async () => {
    const now = Date.now();
    const expiresAt = new Date(now + 1000 * 60 * 60 * 24); // 1 day from now
    const promise = createApiKey(
      { scopes: ['read', 'write'] },
      {
        sub: 'my-user',
        iss: new URL('https://example.com'),
        aud: 'api-key',
        expiresAt,
      }
    );
    await expect(promise).resolves.toBeDefined();
    const { jwks, jwt } = await promise;
    const decodePromise = jose.jwtVerify(jwt, jose.createLocalJWKSet(jwks));
    await expect(decodePromise).resolves.toBeDefined();
    const { payload, protectedHeader } = await decodePromise;
    const kid = protectedHeader.kid;
    expect(kid).toBeTypeOf('string');
    const expectedIssuer = `https://example.com/${kid}`;
    const expected = {
      sub: 'my-user',
      iss: expectedIssuer,
      aud: 'api-key',
      exp: Math.floor(expiresAt.getTime() / 1000),
      iat: expect.any(Number),
      scopes: ['read', 'write'],
    };
    expect(payload).toEqual(expected);
    expect(protectedHeader.alg).toBe('RS256');
    expect(protectedHeader.kid).toBe(jwks.keys[0].kid);
  });
});
