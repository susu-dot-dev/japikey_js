import { describe, test, expect, Mock } from 'vitest';
import * as jose from 'jose';
import { createApiKey, CreateApiKeyOptions } from '../src/sign.ts';
import { VER, ALG } from '@japikey/shared';
import {
  IncorrectUsageError,
  SigningError,
  UnknownError,
} from '@japikey/shared';

const iat = Date.now() - 100;
export const baseIssuer = new URL('https://example.com');
export function userClaims() {
  return {
    scopes: ['read', 'write'],
    iat: Math.floor(iat / 1000),
  };
}

export function apiKeyOptions(): CreateApiKeyOptions {
  return {
    sub: 'my-user',
    iss: baseIssuer,
    aud: 'api-key',
    expiresAt: new Date(iat + 1000 * 60 * 60 * 24), // 1 day from now
  };
}

describe('createApiKey', () => {
  test('create a valid API key', async () => {
    const expiresAt = new Date(iat + 1000 * 60 * 60 * 24); // 1 day from now
    const promise = createApiKey(userClaims(), apiKeyOptions());
    await expect(promise).resolves.toBeDefined();
    const { jwk, jwt } = await promise;
    const decodePromise = jose.jwtVerify(
      jwt,
      jose.createLocalJWKSet({ keys: [jwk] })
    );
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
      ver: VER,
    };
    expect(payload).toEqual(expected);
    expect(protectedHeader.alg).toBe(ALG);
    expect(protectedHeader.kid).toBe(jwk.kid);
  });

  const expiresTests: { input: number; expected: number }[] = [
    { input: 0, expected: 0 },
    { input: 999, expected: 0 },
    { input: 1000, expected: 1 },
    { input: 2001, expected: 2 },
  ];
  test.each(expiresTests)(
    'api key with $input exp',
    async ({ input, expected }) => {
      const promise = createApiKey(userClaims(), {
        ...apiKeyOptions(),
        expiresAt: new Date(input),
      });
      await expect(promise).resolves.toBeDefined();
      const { jwt } = await promise;
      const claims = await jose.decodeJwt(jwt);
      expect(claims.exp).toBe(expected);
    }
  );

  test('negative expiresAt throws incorrect_usage', async () => {
    const promise = createApiKey(userClaims(), {
      ...apiKeyOptions(),
      expiresAt: new Date(-1),
    });
    await expect(promise).rejects.toThrow(IncorrectUsageError);
  });

  test('empty sub throws incorrect_usage', async () => {
    const promise = createApiKey(userClaims(), { ...apiKeyOptions(), sub: '' });
    await expect(promise).rejects.toThrow(IncorrectUsageError);
  });

  const issuerTests: { input: string; expected: string }[] = [
    { input: 'https://example.com', expected: 'https://example.com/:kid' },
    { input: 'https://example.com/', expected: 'https://example.com/:kid' },
    {
      input: 'https://example.com?foo=bar',
      expected: 'https://example.com/:kid',
    },
    {
      input: 'https://example.com?foo=bar#anchor',
      expected: 'https://example.com/:kid',
    },
    {
      input: 'https://localhost:8080?foo=bar#anchor',
      expected: 'https://localhost:8080/:kid',
    },
    {
      input: 'http://localhost:5173/my-path/?foo=bar',
      expected: 'http://localhost:5173/my-path/:kid',
    },
  ];
  test.each(issuerTests)('issuer $input', async ({ input, expected }) => {
    const promise = createApiKey(userClaims(), {
      ...apiKeyOptions(),
      iss: new URL(input),
    });
    await expect(promise).resolves.toBeDefined();
    const { jwt } = await promise;
    const claims = await jose.decodeJwt(jwt);
    const header = jose.decodeProtectedHeader(jwt);
    expect(header.kid).toBeDefined();
    const expectedIssuer = expected.replace(':kid', header.kid!);
    expect(claims.iss).toBe(expectedIssuer);
  });

  test('generateKeyPair errors are wrapped', async () => {
    (jose.generateKeyPair as Mock).mockImplementation(() => {
      throw new Error('generateKeyPair mock error');
    });
    const promise = createApiKey(userClaims(), {
      ...apiKeyOptions(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    });
    await expect(promise).rejects.toThrow(SigningError);
  });

  test('generateJWK errors are wrapped', async () => {
    (jose.exportJWK as Mock).mockImplementation(() => {
      throw new Error('exportJWK mock error');
    });
    const promise = createApiKey(userClaims(), apiKeyOptions());
    await expect(promise).rejects.toThrow(SigningError);
  });

  test('signJWT errors are wrapped', async () => {
    (jose.SignJWT as Mock).mockImplementation(() => {
      throw new Error('SignJWT mock error');
    });
    const promise = createApiKey(userClaims(), apiKeyOptions());
    await expect(promise).rejects.toThrow(SigningError);
  });

  test('handle unexpectedError', async () => {
    const badIssuer = 'not-a-url' as unknown as URL;
    const promise = createApiKey(userClaims(), {
      ...apiKeyOptions(),
      iss: badIssuer,
    });
    await expect(promise).rejects.toThrow(UnknownError);
  });
});
