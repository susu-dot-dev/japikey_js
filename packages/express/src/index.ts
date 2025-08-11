import type { Request, NextFunction, Response } from 'express';
import { Router, RequestHandler } from 'express';
import {
  createApiKey,
  JapikeyError,
  NotFoundError,
  type DatabaseDriver,
  type JSONWebKeySet,
} from '@japikey/japikey';

import {
  shouldAuthenticate,
  authenticate,
  AuthenticateOptions,
} from '@japikey/authenticate';

function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent || !(err instanceof JapikeyError)) {
    return next(err);
  }
  const isProduction = process.env.NODE_ENV === 'production';
  const data: Record<string, unknown> = {
    type: err.errorType,
    message: err.message,
  };
  if (!isProduction) {
    data.stack = err.stack;
    const underlying = err.cause as Error | undefined;
    if (underlying) {
      data.causeStack = underlying.stack;
    }
  }
  res.status(err.code).json({ error: data });
}

export type CreateApiKeyData = {
  expiresAt: Date;
  claims: Record<string, unknown>;
  databaseMetadata: Record<string, unknown>;
};

export type ApiKeyRouterOptions = {
  getUserId: (request: Request) => Promise<string>;
  parseCreateApiKeyRequest: (request: Request) => Promise<CreateApiKeyData>;
  issuer: URL;
  aud: string;
  db: DatabaseDriver;
};

export type JwksRouterOptions = {
  db: DatabaseDriver;
  maxAgeSeconds?: number;
};

export function createApiKeyRouter(options: ApiKeyRouterOptions): Router {
  const router = Router();
  router.post('/', async (request, response) => {
    const userId = await options.getUserId(request);
    const { expiresAt, claims, databaseMetadata } =
      await options.parseCreateApiKeyRequest(request);
    const { jwt, jwk } = await createApiKey(claims, {
      sub: userId,
      iss: options.issuer,
      aud: options.aud,
      expiresAt,
    });
    const kid = jwk.kid as string;
    await options.db.insertApiKey({
      kid,
      user_id: userId,
      revoked: false,
      jwk,
      metadata: databaseMetadata,
    });
    response.json({ api_key: jwt, kid });
  });

  router.get('/my', async (request, response) => {
    const userId = await options.getUserId(request);
    const apiKeys = await options.db.findApiKeys(userId);
    response.json(apiKeys);
  });

  router.get('/:id', async (request, response) => {
    const keyId = request.params.id;
    const userId = await options.getUserId(request);
    const apiKey = await options.db.getApiKey(keyId);
    if (!apiKey || apiKey.user_id !== userId) {
      throw new NotFoundError('API key not found');
    }
    response.json(apiKey);
  });

  router.delete('/:id', async (request, response) => {
    const keyId = request.params.id;
    const userId = await options.getUserId(request);
    const apiKey = await options.db.getApiKey(keyId);
    if (!apiKey || apiKey.user_id !== userId) {
      throw new NotFoundError('API key not found');
    }
    await options.db.revokeApiKey({ user_id: userId, kid: keyId });
    response.json({});
  });
  router.use(errorHandler);
  return router;
}

export function createJWKSRouter(options: JwksRouterOptions): Router {
  const router = Router();
  router.get('/:kid/.well-known/jwks.json', async (request, response) => {
    const kid = request.params.kid;
    const row = await options.db.getApiKey(kid);
    if (!row || row.revoked) {
      throw new NotFoundError('API key not found');
    }
    const jwks: JSONWebKeySet = {
      keys: [row.jwk],
    };
    const maxAge = Math.max(options.maxAgeSeconds ?? 0, 0); // Negative values are undefined per mdn - clamp to 0
    response.setHeader('Cache-Control', `max-age=${maxAge}`);
    response.json(jwks);
  });
  router.use(errorHandler);
  return router;
}

export function authenticateApiKey(
  options: AuthenticateOptions
): RequestHandler {
  const router = Router();
  const handler = async (
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    const authorization = request.headers.authorization ?? '';
    if (!authorization.toLowerCase().startsWith('bearer ')) {
      return next();
    }
    const token = authorization.slice('bearer '.length);
    const isApiKeyAuth = shouldAuthenticate(token, options.baseIssuer);
    if (!isApiKeyAuth) {
      return next();
    }
    const payload = await authenticate(token, options);
    (request as any).user = {
      type: 'api_key',
      claims: payload,
      id: payload.sub,
    };
    next();
  };
  router.use(handler);
  router.use(errorHandler);
  return router;
}
