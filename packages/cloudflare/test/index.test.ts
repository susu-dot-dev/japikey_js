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
import { createJWKSRouter } from '../src/index.ts';

import {
  createApiKey,
  SqliteDriver,
  DatabaseDriver,
  errors,
} from '@japikey/japikey';
const { errorType } = errors;
import {
  baseIssuer,
  userClaims,
  apiKeyOptions,
} from '../../japikey/test/testHelpers.ts';
import { appendPathToUrl } from '../../shared/src/util.ts';

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
  let getDb: Mock;
  const ctx: ExecutionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  };
  beforeAll(async () => {
    db = new SqliteDriver(':memory:');
    getDb = vi.fn();
    await db.ensureTable();
    app = createJWKSRouter(baseIssuer, getDb);
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(() => {
    getDb.mockClear();
    getDb.mockReturnValue(db);
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
    expect(response.json()).resolves.toEqual({ keys: [jwk] });
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
    expect(response.json()).resolves.toEqual({
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
    expect(response.json()).resolves.toEqual({
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
    expect(response.json()).resolves.toEqual({
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
    expect(response.json()).resolves.toEqual({
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
    expect(response.json()).resolves.toEqual({
      error: {
        message: 'Invalid JWKS request',
        type: errorType.NOT_FOUND,
      },
    });
  });

  test('throws an error if a non-japikey error is thrown', async () => {
    getDb.mockImplementation(() => {
      throw new Error('not a japikey error');
    });
    const promise = app.fetch!(
      castRequest(
        new Request(
          appendPathToUrl(baseIssuer, `${uuidv4()}/.well-known/jwks.json`)
        )
      ),
      {},
      ctx
    );
    expect(promise).rejects.toThrow('not a japikey error');
  });
});
