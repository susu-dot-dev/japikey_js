import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as jose from 'jose';
import { v4 as uuidv4 } from 'uuid';
import {
  shouldAuthenticate,
  createGetJWKS,
  authenticate,
  type GetJWKS,
} from '../src/index.ts';
import {
  ALG,
  VER_PREFIX,
  MalformedTokenError,
  UnauthorizedError,
} from '@japikey/shared';
import { createApiKey } from '../../japikey/src/sign.ts';
import {
  apiKeyOptions,
  userClaims,
  baseIssuer,
} from '../../japikey/test/testHelpers.ts';

describe('shouldAuthenticate', () => {
  test('valid token', async () => {
    const { jwt } = await createApiKey(userClaims(), apiKeyOptions());
    expect(shouldAuthenticate(jwt, baseIssuer)).toBe(true);
  });

  test('empty token', async () => {
    expect(shouldAuthenticate('', baseIssuer)).toBe(false);
  });

  test('invalid token', async () => {
    expect(shouldAuthenticate('invalid', baseIssuer)).toBe(false);
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
    { claims: { ver: 'japikey-v0' } },
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
    expect(shouldAuthenticate(token, data.baseIssuer ?? baseIssuer)).toBe(
      false
    );
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
      `https://example.com/${kid}/.well-known/jwks.json`,
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

  // Mints a token and matching JWK. The token's version claim and signing
  // algorithm are independent, so a test can forge either one
  async function mint(opts: {
    ver: string; // The version claim in the token
    alg: string; // The algorithm of the key pair, and the token's header
    jwk?: (jwk: jose.JWK) => jose.JWK; // Customize the published JWK
  }): Promise<{ jwt: string; jwk: jose.JWK }> {
    const { jwt: template, jwk: templateJwk } = await createApiKey(
      userClaims(),
      apiKeyOptions()
    );
    const kid = templateJwk.kid as string;
    const claims = jose.decodeJwt(template);
    const { publicKey, privateKey } = await jose.generateKeyPair(opts.alg);
    let jwk: jose.JWK = { ...(await jose.exportJWK(publicKey)), kid };
    if (opts.jwk) {
      jwk = opts.jwk(jwk);
    }
    const jwt = await new jose.SignJWT({ ...claims, ver: opts.ver })
      .setProtectedHeader({ alg: opts.alg, kid })
      .sign(privateKey);
    return { jwt, jwk };
  }

  function getJWKSFor(jwk: jose.JWK): GetJWKS {
    return () => jose.createLocalJWKSet({ keys: [jwk] });
  }

  async function run(data: { jwt: string; jwk: jose.JWK }) {
    return authenticate(data.jwt, {
      getJWKS: getJWKSFor(data.jwk),
      baseIssuer,
    });
  }

  test('minted keys are v2: ES256 with ver and alg in the jwk', async () => {
    const { jwt, jwk } = await createApiKey(userClaims(), apiKeyOptions());
    expect(jwk).toMatchObject({
      kty: 'EC',
      crv: 'P-256',
      alg: 'ES256',
      ver: 2,
    });
    expect(jwk).not.toHaveProperty('d');
    expect(jose.decodeJwt(jwt).ver).toBe('japikey-v2');
    expect(jose.decodeProtectedHeader(jwt).alg).toBe('ES256');
    await expect(
      authenticate(jwt, { getJWKS: getJWKSFor(jwk), baseIssuer })
    ).resolves.toBeDefined();
  });

  test('v2 works through a remote JWKS fetch', async () => {
    const { jwt, jwk } = await createApiKey(userClaims(), apiKeyOptions());
    const getJWKS = createGetJWKS(baseIssuer, {
      [jose.customFetch]: (async () =>
        new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { 'content-type': 'application/json' },
        })) as unknown as jose.FetchImplementation,
    });
    await expect(
      authenticate(jwt, { getJWKS, baseIssuer })
    ).resolves.toBeDefined();
  });

  test('v1 (RS256) keys still authenticate, with no ver or alg in the jwk', async () => {
    const data = await mint({ ver: 'japikey-v1', alg: 'RS256' });
    expect(data.jwk.kty).toBe('RSA');
    expect(data.jwk).not.toHaveProperty('ver');
    expect(data.jwk).not.toHaveProperty('alg');
    await expect(run(data)).resolves.toBeDefined();
  });

  test('v1 keys also authenticate if the jwk has ver 1 and alg RS256', async () => {
    const data = await mint({
      ver: 'japikey-v1',
      alg: 'RS256',
      jwk: jwk => ({ ...jwk, ver: 1, alg: 'RS256' }),
    });
    await expect(run(data)).resolves.toBeDefined();
  });

  // The version in the token picks the algorithm. Forging it must always fail,
  // whether the algorithms are in different families (RS vs ES) or the same one
  // (ES256 vs ES384), since the token's own alg header must be the pinned one
  const forged: { name: string; ver: string; alg: string }[] = [
    { name: 'v1 token signed with ES256', ver: 'japikey-v1', alg: 'ES256' },
    { name: 'v2 token signed with RS256', ver: 'japikey-v2', alg: 'RS256' },
    { name: 'v2 token signed with PS256', ver: 'japikey-v2', alg: 'PS256' },
    { name: 'v1 token signed with RS512', ver: 'japikey-v1', alg: 'RS512' },
    { name: 'v2 token signed with ES384', ver: 'japikey-v2', alg: 'ES384' },
    { name: 'v2 token signed with ES512', ver: 'japikey-v2', alg: 'ES512' },
  ];
  test.each(forged)('401: $name', async data => {
    const minted = await mint(data);
    await expect(run(minted)).rejects.toThrowError(UnauthorizedError);
  });

  test('401 when a v2 token is checked against an RSA key', async () => {
    const rsa = await mint({ ver: 'japikey-v1', alg: 'RS256' });
    const v2 = await mint({ ver: 'japikey-v2', alg: 'ES256' });
    await expect(
      authenticate(v2.jwt, {
        getJWKS: getJWKSFor({ ...rsa.jwk, kid: v2.jwk.kid }),
        baseIssuer,
      })
    ).rejects.toThrowError(UnauthorizedError);
  });

  test('401 when a v1 token is checked against an EC key', async () => {
    const v1 = await mint({ ver: 'japikey-v1', alg: 'RS256' });
    const ec = await mint({ ver: 'japikey-v2', alg: 'ES256' });
    await expect(
      authenticate(v1.jwt, {
        getJWKS: getJWKSFor({ ...ec.jwk, kid: v1.jwk.kid }),
        baseIssuer,
      })
    ).rejects.toThrowError(UnauthorizedError);
  });

  test('401 when the jwk declares a different alg than the token', async () => {
    const data = await mint({
      ver: 'japikey-v2',
      alg: 'ES256',
      jwk: jwk => ({ ...jwk, alg: 'ES384' }),
    });
    await expect(run(data)).rejects.toThrowError(UnauthorizedError);
  });

  test('401 when the token claims the unsecured alg', async () => {
    const { jwt: template, jwk } = await createApiKey(
      userClaims(),
      apiKeyOptions()
    );
    const claims = jose.decodeJwt(template);
    const kid = jose.decodeProtectedHeader(template).kid;
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid })).toString(
      'base64url'
    );
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    await expect(
      authenticate(`${header}.${payload}.`, {
        getJWKS: getJWKSFor(jwk),
        baseIssuer,
      })
    ).rejects.toThrowError(UnauthorizedError);
  });

  test('401 when an HS256 token is signed with the public key as the secret', async () => {
    const { jwt: template, jwk } = await createApiKey(
      userClaims(),
      apiKeyOptions()
    );
    const hs = await new jose.SignJWT(jose.decodeJwt(template))
      .setProtectedHeader({ alg: 'HS256', kid: jwk.kid })
      .sign(new TextEncoder().encode(JSON.stringify(jwk)));
    await expect(
      authenticate(hs, { getJWKS: getJWKSFor(jwk), baseIssuer })
    ).rejects.toThrowError(UnauthorizedError);
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
