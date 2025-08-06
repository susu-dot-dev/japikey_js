import { NotFoundError, JapikeyError } from '@japikey/shared';
import type { DatabaseDriver, JSONWebKeySet } from '@japikey/japikey';
import { validate as validateUuid } from 'uuid';
import type {
  ExportedHandler,
  Request,
  Response as CloudflareResponse,
} from '@cloudflare/workers-types';

function castResponse(response: Response): CloudflareResponse {
  // CloudflareResponse is just a typescript type, not something that you can call
  // new() on. We need to bridge the existing type in node with the one in cloudflare
  return response as unknown as CloudflareResponse;
}

function wrapError<Args extends unknown[]>(
  fn: (...args: Args) => Promise<CloudflareResponse>
): (...args: Args) => Promise<CloudflareResponse> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof JapikeyError) {
        return castResponse(
          new Response(
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
          )
        );
      }
      throw err;
    }
  };
}

async function handleJWKSRequest(
  kid: string,
  db: DatabaseDriver
): Promise<CloudflareResponse> {
  const row = await db.getApiKey(kid);
  if (!row || row.revoked) {
    throw new NotFoundError('API key not found');
  }
  const jwks: JSONWebKeySet = {
    keys: [row.jwk],
  };
  return castResponse(
    new Response(JSON.stringify(jwks), {
      headers: {
        'Content-Type': 'application/json',
      },
    })
  );
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
    ): Promise<CloudflareResponse> {
      const kid = getWellKnownKid(request, baseIssuer);
      const db = getDb(env);
      return handleJWKSRequest(kid, db);
    }),
  };
}
