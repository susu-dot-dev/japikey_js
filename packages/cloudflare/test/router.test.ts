import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  vi,
  Mock,
  beforeEach,
} from 'vitest';
import type {
  ExportedHandler,
  ExecutionContext,
  Request as CloudflareRequest,
  IncomingRequestCfProperties,
} from '@cloudflare/workers-types';
import { v4 as uuidv4 } from 'uuid';
import * as jose from 'jose';
import {
  createJWKSRouter,
  createApiKeyRouter,
  isJWKSPath,
  type CreateApiKeyRouterOptions,
} from '../src/router.ts';

import {
  createApiKey,
  SqliteDriver,
  DatabaseDriver,
  errorType,
} from '@japikey/japikey';
import {
  baseIssuer,
  userClaims,
  apiKeyOptions,
} from '../../japikey/test/testHelpers.ts';
import { appendPathToUrl } from '../../shared/src/util.ts';
import { UnauthorizedError } from '@japikey/shared';

function castRequest(
  request: Request
): CloudflareRequest<unknown, IncomingRequestCfProperties<unknown>> {
  return request as unknown as CloudflareRequest<
    unknown,
    IncomingRequestCfProperties<unknown>
  >;
}

describe('createJWKSRouter', () => {
  let db: DatabaseDriver;
  let app: ExportedHandler;
  const ctx: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  };
  beforeAll(async () => {
    db = new SqliteDriver(':memory:');
    await db.ensureTable();
    app = createJWKSRouter(baseIssuer, db);
  });
  afterAll(async () => {
    await db.close();
  });

  test('returns the JWKS for a valid kid', async () => {
    const { jwk, kid } = await createApiKey(userClaims(), apiKeyOptions());
    await db.insertApiKey({
      user_id: apiKeyOptions().sub,
      revoked: false,
      metadata: {},
      jwk,
      kid,
    });
    const response = await app.fetch!(
      castRequest(
        new Request(appendPathToUrl(baseIssuer, `${kid}/.well-known/jwks.json`))
      ),
      {},
      ctx
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ keys: [jwk] });
  });

  test('returns a 404 for a revoked kid', async () => {
    const { jwk, kid } = await createApiKey(userClaims(), apiKeyOptions());
    await db.insertApiKey({
      user_id: apiKeyOptions().sub,
      revoked: false,
      metadata: {},
      jwk,
      kid,
    });
    await db.revokeApiKey({ user_id: apiKeyOptions().sub, kid });
    const response = await app.fetch!(
      castRequest(
        new Request(appendPathToUrl(baseIssuer, `${kid}/.well-known/jwks.json`))
      ),
      {},
      ctx
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: 'API key not found',
        type: errorType.NOT_FOUND,
      },
    });
  });

  test('returns a 404 for a non-existent kid', async () => {
    const missingKid = uuidv4();
    const response = await app.fetch!(
      castRequest(
        new Request(
          appendPathToUrl(baseIssuer, `${missingKid}/.well-known/jwks.json`)
        )
      ),
      {},
      ctx
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: 'API key not found',
        type: errorType.NOT_FOUND,
      },
    });
  });

  test('returns a 404 for a malformed kid', async () => {
    const response = await app.fetch!(
      castRequest(
        new Request(
          appendPathToUrl(baseIssuer, `not-a-uuid/.well-known/jwks.json`)
        )
      ),
      {},
      ctx
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: 'Invalid JWKS request',
        type: errorType.NOT_FOUND,
      },
    });
  });

  test('returns a 404 for the wrong subpath', async () => {
    const response = await app.fetch!(
      castRequest(
        new Request(
          appendPathToUrl(
            baseIssuer,
            `another-subpath/${uuidv4()}/.well-known/jwks.json`
          )
        )
      ),
      {},
      ctx
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: 'Invalid JWKS request',
        type: errorType.NOT_FOUND,
      },
    });
  });

  test('returns a 404 for the wrong issuer', async () => {
    const response = await app.fetch!(
      castRequest(
        new Request(
          appendPathToUrl(
            new URL('https://susu.dev'),
            `${uuidv4()}/.well-known/jwks.json`
          )
        )
      ),
      {},
      ctx
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        message: 'Invalid JWKS request',
        type: errorType.NOT_FOUND,
      },
    });
  });
});

describe('createApiKeyRouter', () => {
  let db: DatabaseDriver;
  let getUserId: Mock;
  let parseCreateApiKeyRequest: Mock;
  let userId: string;
  const ctx: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  };

  beforeAll(async () => {
    db = new SqliteDriver(':memory:');
    await db.ensureTable();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => {
    getUserId = vi.fn();
    parseCreateApiKeyRequest = vi.fn();

    getUserId.mockReset();
    userId = uuidv4();
    getUserId.mockResolvedValue(userId);

    parseCreateApiKeyRequest.mockReset();
    parseCreateApiKeyRequest.mockResolvedValue({
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      claims: {},
      databaseMetadata: {},
    });
  });

  const routePrefixTestData = [
    { routePrefix: '', normalizedPath: '' },
    { routePrefix: '/', normalizedPath: '/' },
    { routePrefix: 'api-keys', normalizedPath: '/api-keys' },
    { routePrefix: 'api-keys/', normalizedPath: '/api-keys/' },
    { routePrefix: '/api-keys', normalizedPath: '/api-keys' },
    { routePrefix: '/api-keys/', normalizedPath: '/api-keys/' },
    { routePrefix: '/subpath/api-keys', normalizedPath: '/subpath/api-keys' },
  ];

  test.each(routePrefixTestData)(
    'creates and gets an api key with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { api_key: string; kid: string };
      expect(body).toEqual({
        api_key: expect.any(String),
        kid: expect.any(String),
      });

      const { kid } = body;
      const getResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${kid}`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(getResponse.status).toBe(200);
      const getBody = (await getResponse.json()) as any;
      expect(getBody).toEqual(
        expect.objectContaining({
          kid,
          user_id: userId,
          revoked: false,
        })
      );
    }
  );

  test.each(routePrefixTestData)(
    'creates and gets an api key with claims from request body with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      parseCreateApiKeyRequest.mockImplementation(async (request, env) => {
        const body = await request.json();
        return {
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
          claims: {
            scopes: ['read', 'write'],
            os: 'linux',
          },
          databaseMetadata: {
            tags: ['red'],
          },
        };
      });

      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scopes: ['read', 'write'],
              os: 'linux',
            }),
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { api_key: string; kid: string };
      expect(body).toEqual({
        api_key: expect.any(String),
        kid: expect.any(String),
      });

      const { kid, api_key } = body;
      const decoded = await jose.decodeJwt(api_key);
      expect(decoded.scopes).toEqual(['read', 'write']);
      expect(decoded.os).toBe('linux');

      const getResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${kid}`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(getResponse.status).toBe(200);
      const getBody = await getResponse.json();
      expect(getBody).toEqual(
        expect.objectContaining({
          kid,
          user_id: userId,
          revoked: false,
          metadata: {
            tags: ['red'],
          },
        })
      );
    }
  );

  test.each(routePrefixTestData)(
    '/my with no api keys with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/my`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual([]);
    }
  );

  test.each(routePrefixTestData)(
    '/my with one api key with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const createResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
          })
        ),
        {},
        ctx
      );
      expect(createResponse.status).toBe(200);
      const createBody = (await createResponse.json()) as {
        api_key: string;
        kid: string;
      };
      const { kid } = createBody;

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/my`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as any[];
      expect(body).toEqual([
        expect.objectContaining({
          kid,
          user_id: userId,
          revoked: false,
        }),
      ]);
    }
  );

  test.each(routePrefixTestData)(
    '/my with two keys, one revoked with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const createResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
          })
        ),
        {},
        ctx
      );
      expect(createResponse.status).toBe(200);
      const createBody = (await createResponse.json()) as {
        api_key: string;
        kid: string;
      };
      const { kid } = createBody;

      const revokeResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${kid}`, {
            method: 'DELETE',
          })
        ),
        {},
        ctx
      );
      expect(revokeResponse.status).toBe(200);

      const createResponse2 = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
          })
        ),
        {},
        ctx
      );
      expect(createResponse2.status).toBe(200);
      const createBody2 = (await createResponse2.json()) as {
        api_key: string;
        kid: string;
      };
      const { kid: kid2 } = createBody2;

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/my`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as any[];
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kid,
            user_id: userId,
            revoked: true,
          }),
          expect.objectContaining({
            kid: kid2,
            user_id: userId,
            revoked: false,
          }),
        ])
      );
    }
  );

  test.each(routePrefixTestData)(
    '/my rejects if auth fails with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      getUserId.mockRejectedValue(new UnauthorizedError('auth failed'));

      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/my`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(403);
    }
  );

  test.each(routePrefixTestData)(
    'get :id fails if auth fails with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const createResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
          })
        ),
        {},
        ctx
      );
      expect(createResponse.status).toBe(200);
      const createBody = (await createResponse.json()) as {
        api_key: string;
        kid: string;
      };
      const { kid } = createBody;

      getUserId.mockRejectedValue(new UnauthorizedError('auth failed'));
      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${kid}`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(403);
    }
  );

  test.each(routePrefixTestData)(
    'get :id fails if the key does not belong to the user with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const createResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
          })
        ),
        {},
        ctx
      );
      expect(createResponse.status).toBe(200);
      const createBody = (await createResponse.json()) as {
        api_key: string;
        kid: string;
      };
      const { kid } = createBody;

      getUserId.mockResolvedValue(uuidv4());
      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${kid}`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({
        error: {
          message: 'API key not found',
          type: errorType.NOT_FOUND,
        },
      });
    }
  );

  test.each(routePrefixTestData)(
    'get :id fails if the key does not exist with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${uuidv4()}`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({
        error: {
          message: 'API key not found',
          type: errorType.NOT_FOUND,
        },
      });
    }
  );

  test.each(routePrefixTestData)(
    'get :id fails if the key is not a uuid with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/not-a-uuid`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({
        error: {
          message: 'Invalid API key ID',
          type: errorType.NOT_FOUND,
        },
      });
    }
  );

  test.each(routePrefixTestData)(
    'creates and deletes an api key with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const createResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
          })
        ),
        {},
        ctx
      );
      expect(createResponse.status).toBe(200);
      const createBody = (await createResponse.json()) as {
        api_key: string;
        kid: string;
      };
      const { kid } = createBody;

      const deleteResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${kid}`, {
            method: 'DELETE',
          })
        ),
        {},
        ctx
      );
      expect(deleteResponse.status).toBe(200);

      const getResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${kid}`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(getResponse.status).toBe(200);
      const getBody = (await getResponse.json()) as any;
      expect(getBody.revoked).toBe(true);
    }
  );

  test.each(routePrefixTestData)(
    'delete :id fails if not authenticated with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const createResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
          })
        ),
        {},
        ctx
      );
      expect(createResponse.status).toBe(200);
      const createBody = (await createResponse.json()) as {
        api_key: string;
        kid: string;
      };
      const { kid } = createBody;

      getUserId.mockRejectedValue(new UnauthorizedError('auth failed'));
      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${kid}`, {
            method: 'DELETE',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(403);
    }
  );

  test.each(routePrefixTestData)(
    'delete :id fails if the key does not belong to the user with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const createResponse = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}`, {
            method: 'POST',
          })
        ),
        {},
        ctx
      );
      expect(createResponse.status).toBe(200);
      const createBody = (await createResponse.json()) as {
        api_key: string;
        kid: string;
      };
      const { kid } = createBody;

      getUserId.mockResolvedValue(uuidv4());
      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/${kid}`, {
            method: 'DELETE',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(404);
    }
  );

  test.each(routePrefixTestData)(
    'delete :id fails if the key does not exist with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/non-existent-kid`, {
            method: 'DELETE',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(404);
    }
  );

  test.each(routePrefixTestData)(
    'returns the user-defined error when authentication fails with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const expressError: any = new Error('tempest in a teapot');
      expressError.statusCode = 418;
      expressError.statusMessage = 'I am a teapot';
      getUserId.mockRejectedValue(expressError);

      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const promise = app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/my`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      await expect(promise).rejects.toThrow('tempest in a teapot');
    }
  );

  test.each(routePrefixTestData)(
    'returns a japikeyerror when authentication fails with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const underlying = new Error('bad header');
      getUserId.mockRejectedValue(
        new UnauthorizedError('my custom error', { cause: underlying })
      );

      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const response = await app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/my`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({
        error: {
          message: 'my custom error',
          type: errorType.UNAUTHORIZED,
        },
      });
    }
  );

  test.each(routePrefixTestData)(
    'throws an error if a non-japikey error is thrown with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      getUserId.mockImplementation(() => {
        throw new Error('not a japikey error');
      });

      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const promise = app.fetch!(
        castRequest(
          new Request(`https://example.com${normalizedPath}/my`, {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      await expect(promise).rejects.toThrow('not a japikey error');
    }
  );

  test.each(routePrefixTestData)(
    'returns a 404 for a non-existent route with routePrefix: $routePrefix',
    async ({ routePrefix, normalizedPath }) => {
      const options: CreateApiKeyRouterOptions<unknown> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com'),
        aud: 'api-key',
        db,
        routePrefix,
      };

      const app = createApiKeyRouter(options);

      const response = await app.fetch!(
        castRequest(
          new Request('https://example.com/non-existent-route', {
            method: 'GET',
          })
        ),
        {},
        ctx
      );
      expect(response.status).toBe(404);
    }
  );
});

describe('isJWKSPath', () => {
  const baseIssuer = new URL('https://example.com');

  test('returns true for valid JWKS path with UUID', () => {
    const request = new Request(
      'https://example.com/123e4567-e89b-12d3-a456-426614174000/.well-known/jwks.json'
    );
    expect(isJWKSPath(request, baseIssuer)).toBe(true);
  });

  test('returns false for valid JWKS path with trailing slash', () => {
    const request = new Request(
      'https://example.com/123e4567-e89b-12d3-a456-426614174000/.well-known/jwks.json/'
    );
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for invalid UUID', () => {
    const request = new Request(
      'https://example.com/not-a-uuid/.well-known/jwks.json'
    );
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for wrong path structure', () => {
    const request = new Request(
      'https://example.com/123e4567-e89b-12d3-a456-426614174000/wrong-path/jwks.json'
    );
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for wrong issuer', () => {
    const request = new Request(
      'https://different.com/123e4567-e89b-12d3-a456-426614174000/.well-known/jwks.json'
    );
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for missing .well-known', () => {
    const request = new Request(
      'https://example.com/123e4567-e89b-12d3-a456-426614174000/jwks.json'
    );
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for wrong filename', () => {
    const request = new Request(
      'https://example.com/123e4567-e89b-12d3-a456-426614174000/.well-known/keys.json'
    );
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for extra path segments', () => {
    const request = new Request(
      'https://example.com/extra/123e4567-e89b-12d3-a456-426614174000/.well-known/jwks.json'
    );
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for empty kid', () => {
    const request = new Request('https://example.com//.well-known/jwks.json');
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for non-JWKS path', () => {
    const request = new Request('https://example.com/api/users');
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for root path', () => {
    const request = new Request('https://example.com/');
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns false for empty path', () => {
    const request = new Request('https://example.com');
    expect(isJWKSPath(request, baseIssuer)).toBe(false);
  });

  test('returns true for valid JWKS path with different base issuer', () => {
    const customIssuer = new URL('https://api.custom.com');
    const request = new Request(
      'https://api.custom.com/123e4567-e89b-12d3-a456-426614174000/.well-known/jwks.json'
    );
    expect(isJWKSPath(request, customIssuer)).toBe(true);
  });

  test('returns false for valid JWKS path with wrong base issuer', () => {
    const customIssuer = new URL('https://api.custom.com');
    const request = new Request(
      'https://example.com/123e4567-e89b-12d3-a456-426614174000/.well-known/jwks.json'
    );
    expect(isJWKSPath(request, customIssuer)).toBe(false);
  });
});
