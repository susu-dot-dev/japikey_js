import type { Request, NextFunction, Response } from 'express';
import { Router } from 'express';
import type { JSONWebKeySet } from 'jose';
import {
  UnauthorizedError,
  JapikeyError,
  NotFoundError,
} from '@japikey/shared';
import { createApiKey, type DatabaseDriver } from '@japikey/japikey';

function errorHandler(
  err: Error,
  req: Request,
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

export type CreateRouterOptions = {
  getUserId: (request: Request) => Promise<string>;
  issuer: URL;
  aud: string;
  maxDurationSeconds: number;
  db: DatabaseDriver;
};

export function createApiKeyRouter(options: CreateRouterOptions): Router {
  const router = Router();
  router.post('/', async (request, response) => {
    const userId = await options.getUserId(request);
    const claims = {}; // TODO
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365); // TODO
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
      metadata: {}, // TODO
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

export function createJWKSRouter(db: DatabaseDriver): Router {
  const router = Router();
  router.get('/:kid/.well-known/jwks.json', async (request, response) => {
    const kid = request.params.kid;
    const row = await db.getApiKey(kid);
    if (!row || row.revoked) {
      throw new NotFoundError('API key not found');
    }
    const jwks: JSONWebKeySet = {
      keys: [row.jwk],
    };
    response.json(jwks);
  });
  router.use(errorHandler);
  return router;
}
