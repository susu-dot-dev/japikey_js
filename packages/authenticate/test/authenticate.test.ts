import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as jose from 'jose';
import { v4 as uuidv4 } from 'uuid';
import {
  shouldAuthenticate,
  createGetJWKS,
  authenticate,
  type GetJWKS,
} from '../src/index.ts';
import { ALG, MalformedTokenError, UnauthorizedError } from '@japikey/shared';
import { createApiKey } from '../../japikey/src/sign.ts';
import {
  apiKeyOptions,
  userClaims,
  baseIssuer,
} from '../../japikey/test/testHelpers.ts';

describe('shouldAuthenticate', () => {
  test('valid token', async () => {
    const { jwt } = await createApiKey(userClaims(), apiKeyOptions());
    const promise = shouldAuthenticate(jwt, baseIssuer);
    await expect(promise).resolves.toBe(true);
  });

  test('empty token', async () => {
    const promise = shouldAuthenticate('', baseIssuer);
    await expect(promise).resolves.toBe(false);
  });

  test('invalid token', async () => {
    const promise = shouldAuthenticate('invalid', baseIssuer);
    await expect(promise).resolves.toBe(false);
  });

  const invalidClaimsTests: {
    claims: Record<string, unknown>;
    baseIssuer?: URL;
  }[] = [
    { claims: { iss: null } },
    { claims: { iss: '' } },
    { claims: { iss: 42 } },
    {
      claims: {
        iss: `https://example.com/sub_path_without_trailing_slash/${uuidv4()}`,
      },
      baseIssuer: new URL(
        'https://example.com/sub_path_without_trailing_slash'
      ),
    },
    { claims: { iss: `https://susu.dev/${uuidv4()}` } },
    {
      claims: { iss: `https://example.com/issuer/not_a_uuid}` },
      baseIssuer: new URL('https://example.com/issuer'),
    },
    { claims: { iss: `https://example.com/${uuidv4()}` } },
    {
      claims: { iss: `https://example.com/extra_path/${uuidv4()}` },
      baseIssuer,
    },
    { claims: { ver: null } },
    { claims: { ver: 42 } },
    { claims: { ver: '' } },
    { claims: { ver: 'JAPIKEY-V123' } },
    { claims: { ver: 'extra-chars-japikey-v1' } },
    { claims: { ver: 'japikey-v1-extra-suffix' } },
    { claims: { ver: 'japikey-v1.1' } },
    { claims: { ver: 'japikey-v1234556' } },
    { claims: { ver: 'japikey-v99' } },
  ];
  test.each(invalidClaimsTests)('invalid claims %s', async data => {
    const { jwt } = await createApiKey(userClaims(), apiKeyOptions());
    const validClaims = await jose.decodeJwt(jwt);
    const validHeader = await jose.decodeProtectedHeader(jwt);
    const newClaims = { ...validClaims, ...data.claims };
    const { publicKey, privateKey } = await jose.generateKeyPair(ALG);
    const token = await new jose.SignJWT(newClaims)
      .setProtectedHeader({
        kid: validHeader.kid,
        alg: ALG,
      })
      .sign(privateKey);
    const promise = shouldAuthenticate(token, data.baseIssuer ?? baseIssuer);
    await expect(promise).resolves.toBe(false);
  });
});

describe('createGetJWKS', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let jwt: string;
  let jwk: jose.JWK;
  let kid: string;
  let iss: string;
  beforeEach(async () => {
    mockFetch = vi.fn();
    const result = await createApiKey(userClaims(), apiKeyOptions());
    jwt = result.jwt;
    jwk = result.jwk;
    kid = result.kid;
    const unverified = jose.decodeJwt(jwt);
    iss = unverified.iss!;
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ keys: [jwk] }),
    });
  });

  test('generates the correct URL', async () => {
    expect(iss).toEqual(`https://example.com/${kid}`);

    const getJWKS = createGetJWKS(baseIssuer, {
      [jose.customFetch]: mockFetch,
    });
    const getKey = getJWKS({ kid, iss: new URL(iss) });
    const verifyPromise = jose.jwtVerify(jwt, getKey);
    await expect(verifyPromise).resolves.toBeDefined();
    await expect(mockFetch).toHaveBeenCalledWith(
      `https://example.com/${kid}/.well_known/jwks.json`,
      expect.anything()
    );
  });

  test('rejects issuers that do not match', async () => {
    const differentIssuer = new URL('https://susu.dev');
    const getJWKS = createGetJWKS(differentIssuer, {
      [jose.customFetch]: mockFetch,
    });
    expect(() => getJWKS({ kid, iss: new URL(iss) })).toThrowError(
      MalformedTokenError
    );
  });
});

describe('authenticate', () => {
  test('valid token', async () => {
    const { jwt, jwk } = await createApiKey(userClaims(), apiKeyOptions());
    const getJWKS: GetJWKS = ({ kid }) => {
      return async () => {
        if (kid !== jwk.kid) {
          throw new Error('Invalid kid');
        }
        return jwk;
      };
    };
    const promise = authenticate(jwt, { getJWKS, baseIssuer });
    await expect(promise).resolves.toBeDefined();
  });

  test('401 when the token is not a JWT', async () => {
    const getJWKS = createGetJWKS(baseIssuer);
    const promise = authenticate('not-a-jwt', { getJWKS, baseIssuer });
    await expect(promise).rejects.toThrowError(MalformedTokenError);
  });

  test('403 when the public key is not found', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Not found'));
    const getJWKS = createGetJWKS(baseIssuer, {
      [jose.customFetch]: mockFetch,
    });
    const { jwt } = await createApiKey(userClaims(), apiKeyOptions());
    const promise = authenticate(jwt, { getJWKS, baseIssuer });
    await expect(promise).rejects.toThrowError(UnauthorizedError);
  });
});
