# Express Quickstart

This quickstart helps you set up an API server that can be used to create API keys. It works with your existing express application

# Prerequisites

Have an existing express() application, that has some other mechanism for authentication. When a user creates an API key, we only want to grant access for that user, after all! You'll also need a database to store the API key information. This quickstart assumes you're using sqlite, but you can use a different adapter to suit your needs

# Installing japikey

```bash
npm install --save "@japikey/japikey"
npm install --save "@japikey/express"
npm install --save "@japikey/sqlite"
```

# Adding the router

When you're setting up your app(), you just need to add code like this:

```ts
import { UnauthorizedError } from '@japikey/japikey';
import SqliteDriver from '@japikey/sqlite';
import {
  createApiKeyRouter,
  createJWKSRouter,
  type CreateRouterOptions,
  type CreateApiKeyData,
} from '@japikey/express';
const app = express();
app.use(yourMiddlewareForAuthentication);
app.use('/', yourUsualAppEndpoints);

function getUserId(request: Request): Promise<string> {
  if (!request.user) {
    // Your auth middleware didn't set a user,
    // let's say because their access_token was wrong
    throw new UnauthorizedError();
  }
}

function parseCreateApiKeyRequest(request: Request): Promise<CreateApiKeyData> {
  const { expiresAt, scopes } = request.body;
  // Add extra validation as desired
  return {
    expiresAt: new Date(expiresAt),
    claims: { scopes }, // Any claims you want encoded in the token
    metadata: {}, // Any extra things you want to store in the database
  };
}
const db = new SqliteDriver(process.env.SQLITE_PATH);
const options: CreateRouterOptions = {
  getUserId,
  parseCreateApiKeyRequest,
  issuer: new URL('https://example.com/'),
  aud: 'api-key',
  db,
};

const apiKeyRouter = createApiKeyRouter(options);
const jwksRouter = createJWKSRouter(db);
app.use('/api-keys', apiKeyRouter);
app.use('/', jwksRouter);
```

## Details about the configuration

There are two separate endpoint banks to implement. The apiKeyRouter handles the CRUD operations to create, list, and delete an api key.

The jwksRouter handles any client that wants to validate the API key. It provides the public key data via the `.well-known/jwks.json` endpoint. These two endpoints do need to be configured in a compatible way, specifically around the issuer URL.

The `issuer` passed into createApiKeyRouter MUST be the full URL corresponding to the root of the jwksRouter.

For example, if your domain is `https://example.com` and you use `app.use('/', jwksRouter)`, your issuer MUST be `https://example.com`. If instead you do `app.use('//my-subpath', jwksRouter)`, then the issuer MUST be `https://example.com/my-subpath`

The issuer URL does not necessarily have anything to do with the URL that the apiKeyRouter is on. Your apiKeyRoute could be `https://example.com/api-keys` or `https://example.com/my/long/subpath` or `https://susu.dev` and that doesn't have any impact on the JWKS endpoint.

Besides the issuer, the other critical parameter passed in is the `getUserId` function. That function MUST integrate with your existing authentication system. It MUST raise an exception if the user is not authenticated.

You can throw any error that you want from the method. If you throw one of the errors provided by japikeys (such as `UnauthorizedError`), the router will make sure it gets converted to the proper HTTP status code, with a JSON body for clients. If you throw a different error, it's up to you to have an appropriate errorHandler to ensure the server returns something other than a generic 500 error.

Lastly, the parseCreateApiKeyRequest lets you specify what the payload is to the CREATE endpoint (`POST /api-keys`). You at least need to pass back an expiredAt parameter. (You could always hardcode this to e.g. Date.now() + one year) for example. Any other data is up to your application needs. `claims` get encoded in the token themselves, and `metadata` goes in the database for any of your business logic later

# Validating an API key

Whether you're in the backend, or even on the browser frontend, verifying an API key is a simple process.

For express, there's a helpful middleware:

```bash
npm install --save "@japikey/authenticate"
```

```ts
import { createGetJWKS } from '@japikey/authenticate';
import { authenticateApiKey } from '@japikey/express';

const issuer = new URL('https://example.com');
const getJWKS = createGetJWKS(issuer);

const authenticateOptions: AuthenticateOptions = {
  baseIssuer: issuer,
  getJWKS,
};
app.use('/', authenticateApiKey(authenticateOptions));
```

and on the frontend side, you can call authenticate() directly wherever needed:

```ts
import { createGetJWKS, authenticate } from '@japikey/authenticate';
const issuer = new URL('https://example.com');
const getJWKS = createGetJWKS(issuer);
await authenticate(my_auth_token, { getJWKS, baseIssuer });
```
