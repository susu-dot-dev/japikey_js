import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  Mock,
  vi,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import * as jose from 'jose';
import request from 'supertest';
import express from 'express';
import { createApiKey, type DatabaseDriver } from '@japikey/japikey';
import {
  apiKeyOptions,
  baseIssuer,
  userClaims,
} from '../../japikey/test/testHelpers.ts';
import SqliteDriver from '../../sqlite/src/index.ts';
import {
  createApiKeyRouter,
  createJWKSRouter,
  CreateRouterOptions,
  authenticateApiKey,
} from '../src/index.ts';
import { Router } from 'express';
import { errorType, UnauthorizedError } from '@japikey/shared';
import { AuthenticateOptions, createGetJWKS } from '@japikey/authenticate';

describe('createApiKeyRouter', () => {
  let db: DatabaseDriver;
  let router: Router;
  let app: express.Application;
  let options: CreateRouterOptions;
  let getUserId: Mock;
  let parseCreateApiKeyRequest: Mock;
  let userId: string;
  beforeAll(async () => {
    db = new SqliteDriver(':memory:');
    getUserId = vi.fn();
    parseCreateApiKeyRequest = vi.fn();
    await db.ensureTable();
    options = {
      getUserId,
      parseCreateApiKeyRequest,
      issuer: new URL('https://example.com'),
      aud: 'api-key',
      db,
    };
    router = createApiKeyRouter(options);
    app = express();
    app.use('/', router);
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(() => {
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

  test('creates and gets an api key', async () => {
    const response = await request(app).post('/');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      api_key: expect.any(String),
      kid: expect.any(String),
    });
    const { kid } = response.body;
    const getResponse = await request(app).get(`/${kid}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toEqual(
      expect.objectContaining({
        kid,
        user_id: userId,
        revoked: false,
      })
    );
  });

  test('creates and gets an api key with claims from request body', async () => {
    // Mock parseCreateApiKeyRequest to read from request body
    parseCreateApiKeyRequest.mockImplementation(async request => {
      const body = request.body || {};
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

    const response = await request(app)
      .post('/')
      .send({
        scopes: ['read', 'write'],
        os: 'linux',
      });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      api_key: expect.any(String),
      kid: expect.any(String),
    });

    const { kid, api_key } = response.body;

    const decoded = await jose.decodeJwt(api_key);
    expect(decoded.scopes).toEqual(['read', 'write']);
    expect(decoded.os).toBe('linux');

    const getResponse = await request(app).get(`/${kid}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toEqual(
      expect.objectContaining({
        kid,
        user_id: userId,
        revoked: false,
        metadata: {
          tags: ['red'],
        },
      })
    );
  });

  test('/my with no api keys', async () => {
    const response = await request(app).get('/my');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  test('/my with one api key', async () => {
    const createResponse = await request(app).post('/');
    expect(createResponse.status).toBe(200);
    const { kid } = createResponse.body;

    const response = await request(app).get('/my');
    expect(response.status).toBe(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        kid,
        user_id: userId,
        revoked: false,
      }),
    ]);
  });

  test('/my with two keys, one revoked', async () => {
    const createResponse = await request(app).post('/');
    expect(createResponse.status).toBe(200);
    const { kid } = createResponse.body;
    const revokeResponse = await request(app).delete(`/${kid}`);
    expect(revokeResponse.status).toBe(200);

    const createResponse2 = await request(app).post('/');
    expect(createResponse2.status).toBe(200);
    const { kid: kid2 } = createResponse2.body;

    const response = await request(app).get('/my');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(
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
  });

  test('/my rejects if auth fails', async () => {
    getUserId.mockRejectedValue(new UnauthorizedError('auth failed'));
    const response = await request(app).get('/my');
    expect(response.status).toBe(403);
  });

  test('get :id fails if auth fails', async () => {
    const createResponse = await request(app).post('/');
    expect(createResponse.status).toBe(200);
    const { kid } = createResponse.body;

    getUserId.mockRejectedValue(new UnauthorizedError('auth failed'));
    const response = await request(app).get(`/${kid}`);
    expect(response.status).toBe(403);
  });

  test('get :id fails if the key does not belong to the user', async () => {
    const createResponse = await request(app).post('/');
    expect(createResponse.status).toBe(200);
    const { kid } = createResponse.body;
    getUserId.mockResolvedValue(uuidv4());
    const response = await request(app).get(`/${kid}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        message: 'API key not found',
        type: errorType.NOT_FOUND,
        stack: expect.anything(),
      },
    });
  });

  test('get :id fails if the key does not exist', async () => {
    const response = await request(app).get('/non-existent-kid');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        message: 'API key not found',
        type: errorType.NOT_FOUND,
        stack: expect.anything(),
      },
    });
  });

  test('creates and deletes an api key', async () => {
    const createResponse = await request(app).post('/');
    expect(createResponse.status).toBe(200);
    const { kid } = createResponse.body;
    const deleteResponse = await request(app).delete(`/${kid}`);
    expect(deleteResponse.status).toBe(200);
    const getResponse = await request(app).get(`/${kid}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.revoked).toBe(true);
  });

  test('delete :id fails if not authenticated', async () => {
    const createResponse = await request(app).post('/');
    expect(createResponse.status).toBe(200);
    const { kid } = createResponse.body;
    getUserId.mockRejectedValue(new UnauthorizedError('auth failed'));
    const response = await request(app).delete(`/${kid}`);
    expect(response.status).toBe(403);
  });

  test('delete :id fails if the key does not belong to the user', async () => {
    const createResponse = await request(app).post('/');
    expect(createResponse.status).toBe(200);
    const { kid } = createResponse.body;
    getUserId.mockResolvedValue(uuidv4());
    const response = await request(app).delete(`/${kid}`);
    expect(response.status).toBe(404);
  });

  test('delete :id fails if the key does not exist', async () => {
    const response = await request(app).delete('/non-existent-kid');
    expect(response.status).toBe(404);
  });

  test('returns the user-defined error when authentication fails', async () => {
    const expressError: any = new Error('tempest in a teapot');
    expressError.statusCode = 418;
    expressError.statusMessage = 'I am a teapot';
    getUserId.mockRejectedValue(expressError);
    const response = await request(app).get('/my');
    expect(response.status).toBe(418);
  });

  test('returns a japikeyerror when authentication fails', async () => {
    const underlying = new Error('bad header');
    getUserId.mockRejectedValue(
      new UnauthorizedError('my custom error', { cause: underlying })
    );
    const response = await request(app).get('/my');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        message: 'my custom error',
        type: errorType.UNAUTHORIZED,
        stack: expect.anything(),
        causeStack: expect.anything(),
      },
    });
  });
});

describe('createJWKSRouter', () => {
  let db: DatabaseDriver;
  let router: Router;
  let app: express.Application;
  beforeAll(async () => {
    db = new SqliteDriver(':memory:');
    await db.ensureTable();
    router = createJWKSRouter(db);
    app = express();
    app.use('/my_issuer/', router);
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
    const response = await request(app).get(
      `/my_issuer/${kid}/.well-known/jwks.json`
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ keys: [jwk] });
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
    const response = await request(app).get(
      `/my_issuer/${kid}/.well-known/jwks.json`
    );
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        message: 'API key not found',
        type: errorType.NOT_FOUND,
        stack: expect.anything(),
      },
    });
  });

  test('returns a 404 for a non-existent kid', async () => {
    const response = await request(app).get(
      `/my_issuer/non-existent-kid/.well-known/jwks.json`
    );
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        message: 'API key not found',
        type: errorType.NOT_FOUND,
        stack: expect.anything(),
      },
    });
  });

  test('Handles another middleware that processes errors', async () => {
    const app = express();
    app.use('/', (req, res, next) => {
      // Start writing a response before the route handler is called
      res.status(418).send("I'm a teapot");
      next();
    });
    app.use('/', createJWKSRouter(db));
    const response = await request(app).get(
      '/non-existent-kid/.well-known/jwks.json'
    );
    expect(response.status).toBe(418);
  });
});

describe('authenticateMiddleware', () => {
  let app: express.Application;
  let db: DatabaseDriver;
  let userId: string;
  let jwksRouter: Router;
  beforeAll(async () => {
    db = new SqliteDriver(':memory:');
    await db.ensureTable();

    jwksRouter = createJWKSRouter(db);
    app = express();
    const customFetch: typeof fetch = async (url: string | URL | Request) => {
      const r = new Request(url);
      const path = new URL(r.url).pathname;
      const response = await request(app).get(path);
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: response.headers,
      });
    };

    const getJWKS = createGetJWKS(baseIssuer, {
      [jose.customFetch]: customFetch,
    });

    const authenticateOptions: AuthenticateOptions = {
      baseIssuer: baseIssuer,
      getJWKS,
    };
    // Mount the jwksRouter at a specific path
    app.use('/', jwksRouter);
    app.use('/', authenticateApiKey(authenticateOptions));
    app.use('/check_auth', (req, res) => {
      res.json({ user: (req as any).user ?? null });
    });
  });
  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    userId = uuidv4();
  });

  test('ensure jwks router works properly', async () => {
    const response = await request(app).get(
      `/${uuidv4()}/.well-known/jwks.json`
    );
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        message: 'API key not found',
        type: errorType.NOT_FOUND,
        stack: expect.anything(),
      },
    });
  });

  test('authorizes a valid api key', async () => {
    const { jwk, kid, jwt } = await createApiKey(userClaims(), {
      ...apiKeyOptions(),
      sub: userId,
    });
    await db.insertApiKey({
      user_id: userId,
      revoked: false,
      metadata: {},
      jwk,
      kid,
    });
    const response = await request(app)
      .get('/check_auth')
      .set('Authorization', `Bearer ${jwt}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        type: 'api_key',
        claims: expect.objectContaining({
          sub: userId,
        }),
        id: userId,
      },
    });
  });

  test('Does nothing if there is no auth header', async () => {
    const response = await request(app).get('/check_auth');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null });
  });

  test('Does nothing if the auth header is not a bearer token', async () => {
    const response = await request(app)
      .get('/check_auth')
      .set('Authorization', 'Basic 1234567890');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null });
  });

  test('Does nothing if the auth header is not an api key', async () => {
    const jwt = await new jose.UnsecuredJWT({ sub: userId }).encode();
    const response = await request(app)
      .get('/check_auth')
      .set('Authorization', `Bearer ${jwt}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null });
  });

  test('Throws an error if the api key is revoked', async () => {
    const { jwk, kid, jwt } = await createApiKey(userClaims(), {
      ...apiKeyOptions(),
      sub: userId,
    });
    await db.insertApiKey({
      user_id: userId,
      revoked: false,
      metadata: {},
      jwk,
      kid,
    });
    await db.revokeApiKey({ user_id: userId, kid });
    const response = await request(app)
      .get('/check_auth')
      .set('Authorization', `Bearer ${jwt}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        message: 'Failed to verify token',
        type: errorType.UNAUTHORIZED,
        stack: expect.anything(),
        causeStack: expect.anything(),
      },
    });
  });
});
