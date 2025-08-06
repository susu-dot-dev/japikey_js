import { NotFoundError, JapikeyError } from '@japikey/shared';
import type { DatabaseDriver, JSONWebKeySet } from '@japikey/japikey';
import { createApiKey } from '@japikey/japikey';
import { validate as validateUuid } from 'uuid';
import type { ExportedHandler } from '@cloudflare/workers-types';
import { pathToRegexp } from 'path-to-regexp';

export type CreateApiKeyData = {
  expiresAt: Date;
  claims: Record<string, unknown>;
  databaseMetadata: Record<string, unknown>;
};

export type CreateApiKeyRouterOptions<Env> = {
  getUserId: (request: Request, env: Env) => Promise<string>;
  parseCreateApiKeyRequest: (
    request: Request,
    env: Env
  ) => Promise<CreateApiKeyData>;
  issuer: URL;
  aud: string;
  getDb: (env: Env) => DatabaseDriver;
  routePrefix: string;
};

function wrapError<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof JapikeyError) {
        return new Response(
          JSON.stringify({
            error: {
              type: err.errorType,
              message: err.message,
            },
          }),
          {
            status: err.code,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }
      throw err;
    }
  };
}

async function handleJWKSRequest(
  kid: string,
  db: DatabaseDriver
): Promise<Response> {
  const row = await db.getApiKey(kid);
  if (!row || row.revoked) {
    throw new NotFoundError('API key not found');
  }
  const jwks: JSONWebKeySet = {
    keys: [row.jwk],
  };
  return new Response(JSON.stringify(jwks), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function getWellKnownKid(request: Request, baseIssuer: URL): string {
  if (!request.url.startsWith(baseIssuer.toString())) {
    throw new NotFoundError('Invalid JWKS request');
  }
  let partialPath = request.url.slice(baseIssuer.toString().length);
  if (!partialPath.startsWith('/')) {
    partialPath = `/${partialPath}`;
  }
  const parts = partialPath.split('/');
  if (
    parts.length !== 4 ||
    parts[0] !== '' ||
    parts[2] !== '.well-known' ||
    parts[3] !== 'jwks.json'
  ) {
    throw new NotFoundError('Invalid JWKS request');
  }
  const kid = parts[1];
  if (!kid || !validateUuid(kid)) {
    throw new NotFoundError('Invalid JWKS request');
  }
  return kid;
}

export function createJWKSRouter<Env>(
  baseIssuer: URL,
  getDb: (env: Env) => DatabaseDriver
): ExportedHandler<Env> {
  return {
    fetch: wrapError(async function fetch(
      request: Request,
      env: Env
    ): Promise<Response> {
      const kid = getWellKnownKid(request, baseIssuer);
      const db = getDb(env);
      return handleJWKSRequest(kid, db);
    }),
  };
}

function matchPath(
  request: Request,
  method: string,
  routePrefix: string,
  pattern: string
): { valid: boolean; params: Record<string, unknown> } {
  if (request.method !== method) {
    return { valid: false, params: {} };
  }

  const url = new URL(request.url);
  const pathname = url.pathname;

  const normalizedPrefix =
    routePrefix === ''
      ? ''
      : routePrefix.startsWith('/')
        ? routePrefix
        : `/${routePrefix}`;
  const fullPattern = `${normalizedPrefix}${pattern}`;
  const regexp = pathToRegexp(fullPattern);
  const match = regexp.regexp.exec(pathname);

  if (!match) {
    return { valid: false, params: {} };
  }

  const params: Record<string, unknown> = {};
  regexp.keys.forEach((key, index) => {
    params[key.name] = match[index + 1];
  });

  return { valid: true, params };
}

function ensureKid(params: Record<string, unknown>): string {
  const kid = params.kid ?? params.id;
  if (!kid || typeof kid !== 'string' || !validateUuid(kid)) {
    throw new NotFoundError('Invalid API key ID');
  }
  return kid;
}

async function handleCreateApiKeyRequest<Env>(
  request: Request,
  env: Env,
  options: CreateApiKeyRouterOptions<Env>
): Promise<Response> {
  const userId = await options.getUserId(request, env);
  const { expiresAt, claims, databaseMetadata } =
    await options.parseCreateApiKeyRequest(request, env);
  const { jwt, jwk } = await createApiKey(claims, {
    sub: userId,
    iss: options.issuer,
    aud: options.aud,
    expiresAt,
  });
  const kid = jwk.kid as string;
  const db = options.getDb(env);
  await db.insertApiKey({
    kid,
    user_id: userId,
    revoked: false,
    jwk,
    metadata: databaseMetadata,
  });
  return new Response(JSON.stringify({ api_key: jwt, kid }), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function handleListApiKeysRequest<Env>(
  request: Request,
  env: Env,
  options: CreateApiKeyRouterOptions<Env>
): Promise<Response> {
  const userId = await options.getUserId(request, env);
  const db = options.getDb(env);
  const apiKeys = await db.findApiKeys(userId);
  return new Response(JSON.stringify(apiKeys), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function handleGetApiKeyRequest<Env>(
  request: Request,
  env: Env,
  options: CreateApiKeyRouterOptions<Env>,
  keyId: string
): Promise<Response> {
  const userId = await options.getUserId(request, env);
  const db = options.getDb(env);
  const apiKey = await db.getApiKey(keyId);
  if (!apiKey || apiKey.user_id !== userId) {
    throw new NotFoundError('API key not found');
  }
  return new Response(JSON.stringify(apiKey), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

async function handleRevokeApiKeyRequest<Env>(
  request: Request,
  env: Env,
  options: CreateApiKeyRouterOptions<Env>,
  keyId: string
): Promise<Response> {
  const userId = await options.getUserId(request, env);
  const db = options.getDb(env);
  const apiKey = await db.getApiKey(keyId);
  if (!apiKey || apiKey.user_id !== userId) {
    throw new NotFoundError('API key not found');
  }
  await db.revokeApiKey({ user_id: userId, kid: keyId });
  return new Response(JSON.stringify({}), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export function createApiKeyRouter<Env>(
  options: CreateApiKeyRouterOptions<Env>
): ExportedHandler<Env> {
  return {
    fetch: wrapError(async function fetch(
      request: Request,
      env: Env
    ): Promise<Response> {
      // POST /api-keys - Create API key
      let matchResult = matchPath(request, 'POST', options.routePrefix, '');
      if (matchResult.valid) {
        return handleCreateApiKeyRequest(request, env, options);
      }

      // GET /api-keys/my - List user's API keys
      matchResult = matchPath(request, 'GET', options.routePrefix, '/my');
      if (matchResult.valid) {
        return handleListApiKeysRequest(request, env, options);
      }

      // GET /api-keys/:id - Get specific API key
      matchResult = matchPath(request, 'GET', options.routePrefix, '/:id');
      if (matchResult.valid) {
        const keyId = ensureKid(matchResult.params);
        return handleGetApiKeyRequest(request, env, options, keyId);
      }

      // DELETE /api-keys/:id - Revoke API key
      matchResult = matchPath(request, 'DELETE', options.routePrefix, '/:id');
      if (matchResult.valid) {
        const keyId = ensureKid(matchResult.params);
        return handleRevokeApiKeyRequest(request, env, options, keyId);
      }

      throw new NotFoundError('Route not found');
    }),
  };
}
