# @japikey/cloudflare

This package generates Cloudflare worker routes and middleware to fully integrate japikeys into your app. You can create api keys, view, or delete them, and validate they are valid.
This package is part of the larger @japikey ecosystem. See @japikey/japikey for more information.

# Prerequisites

Have an existing Cloudflare Worker application that has some other mechanism for authentication. When a user creates an API key, we only want to grant access for that user, after all! You'll also need a D1 database to store the API key information.

# Installing japikey

```bash
npm install --save "@japikey/japikey"
npm install --save "@japikey/cloudflare"
```

# Setting up your Worker

Create a standard Cloudflare Worker that handles API key routes and JWKS endpoints:

```ts
import { D1Driver, UnauthorizedError } from '@japikey/cloudflare';
import {
  createApiKeyRouter,
  createJWKSRouter,
  isJWKSPath,
  type ApiKeyRouterOptions,
  type CreateApiKeyData,
} from '@japikey/cloudflare';

interface Env {
  DB: D1Database;
}

async function getUserId(request: Request, env: Env): Promise<string> {
  // This should integrate with your existing auth system
  // For example, you might check for a session cookie or JWT token
  // Example: Check for a user session
  const session = request.headers.get('Authorization');
  if (!session) {
    throw new UnauthorizedError();
  }

  // Validate the session and extract user ID
  // This is where you'd integrate with your auth system
  const userId = await validateSession(session);
  if (!userId) {
    throw new UnauthorizedError();
  }

  return userId;
}

async function parseCreateApiKeyRequest(
  request: Request,
  env: Env
): Promise<CreateApiKeyData> {
  const body = await request.json();
  const { expiresAt, scopes } = body;

  // Add extra validation as desired
  return {
    expiresAt: new Date(expiresAt),
    claims: { scopes }, // Any claims you want encoded in the token
    databaseMetadata: {}, // Any extra things you want to store in the database
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle API key routes
    if (url.pathname.startsWith('/api-keys')) {
      const db = new D1Driver(env.DB);
      await db.ensureTable();

      const options: ApiKeyRouterOptions<Env> = {
        getUserId,
        parseCreateApiKeyRequest,
        issuer: new URL('https://example.com/'),
        aud: 'api-key',
        db,
        routePrefix: '/api-keys',
      };

      const apiKeyRouter = createApiKeyRouter(options);
      return apiKeyRouter.fetch(request, env);
    }

    // Handle JWKS routes
    const baseIssuer = new URL('https://example.com/');
    if (isJWKSPath(request, baseIssuer)) {
      const jwksRouter = createJWKSRouter({
        baseIssuer,
        db,
        maxAgeSeconds: 300,
      });
      return jwksRouter.fetch(request, env);
    }

    // Handle other routes
    return new Response('Not found', { status: 404 });
  },
};
```

## Details about the configuration

There are two separate endpoint banks to implement. The apiKeyRouter handles the CRUD operations to create, list, and delete an api key.

The jwksRouter handles any client that wants to validate the API key. It provides the public key data via the `.well-known/jwks.json` endpoint. These two endpoints do need to be configured in a compatible way, specifically around the issuer URL.

The `issuer` passed into createApiKeyRouter MUST be the full URL corresponding to the root of the jwksRouter.

For example, if your domain is `https://example.com` and you use the baseIssuer as `https://example.com`, your issuer MUST be `https://example.com`. The JWKS endpoint will be available at `https://example.com/{kid}/.well-known/jwks.json`.

The issuer URL does not necessarily have anything to do with the URL that the apiKeyRouter is on. Your apiKeyRoute could be `https://example.com/api-keys` or `https://example.com/my/long/subpath` and that doesn't have any impact on the JWKS endpoint.

Besides the issuer, the other critical parameter passed in is the `getUserId` function. That function MUST integrate with your existing authentication system. It MUST raise an exception if the user is not authenticated.

You can throw any error that you want from the method. If you throw one of the errors provided by japikeys (such as `UnauthorizedError`), the router will make sure it gets converted to the proper HTTP status code, with a JSON body for clients.

Lastly, the parseCreateApiKeyRequest lets you specify what the payload is to the CREATE endpoint (`POST /api-keys`). You at least need to pass back an expiredAt parameter. (You could always hardcode this to e.g. Date.now() + one year) for example. Any other data is up to your application needs. `claims` get encoded in the token themselves, and `databaseMetadata` goes in the database for any of your business logic later.

# Setting up D1 Database

You'll need to create a D1 database and bind it to your worker. In your `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "japikey-db"
database_id = "your-database-id"
```

## Manual Table Creation

Cloudflare already supports table migrations. If you want, you can manually create the table
(see the sql in [d1.ts](./src/d1.ts)). The ensureTable will not make any changes in this case.
However, you must still call ensureTable() in your code

```ts
const db = new D1Driver(env.DB);
await db.ensureTable(); // This call is still necessary, for initializing the prepared statements
```

# Validating an API key

Whether you're in the backend, or even on the browser frontend, verifying an API key is a simple process.

```ts
import { createGetJWKS, authenticate } from '@japikey/authenticate';

const issuer = new URL('https://example.com/');
const getJWKS = createGetJWKS(issuer);
await authenticate(my_auth_token, { getJWKS, baseIssuer: issuer });
```

# API Endpoints

The API key router provides the following endpoints:

- `POST /api-keys` - Create a new API key
- `GET /api-keys/my` - List user's API keys
- `GET /api-keys/:id` - Get specific API key details
- `DELETE /api-keys/:id` - Revoke an API key

The JWKS router provides:

- `GET /{kid}/.well-known/jwks.json` - Get public key for validation

# Error Handling

The router automatically handles common errors and returns appropriate HTTP status codes:

- `400 Bad Request` - Invalid request data
- `401 Unauthorized` - Authentication required
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

All error responses include a JSON body with error details.
