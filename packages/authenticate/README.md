# @japikey/authenticate

This package is used whenever you have an API key, and you want to check to see if it's valid and the claims stored within it

This package understands api keys created by the @japikey/japikey library. Since these keys use public/private key cryptography,
it depends on the caller providing the public key. This can either be done manually, or via a URL such as `.well-known/jwks.json`

This package is part of the @japikey constellation of packages. See @japikey/japikey for more details

# Usage

Given a known issuer (the server that generated your api key), you can set the issuer to that URL
Then, if your server is implementing the JWKS scheme of this repository, you can use `createGetJWKS` to get the correct
public key for the token.

The authenticate method takes the public key, and uses jose.jwtVerify() to validate the api key

```ts
import { createGetJWKS, authenticate } from '@japikey/authenticate';
const issuer = new URL('https://example.com');
const getJWKS = createGetJWKS(issuer);
await authenticate(my_auth_token, { getJWKS, baseIssuer });
```

The authenticate method will throw a `JapikeyError` upon failure. See @japikey/shared for more details about error handling.

In addition, you can also use the `shouldAuthenticate` method to determine if the access token appears to be a japikey (based on its unverified claims)

```ts
import { shouldAuthenticate } from '@japikey/authenticate';
const issuer = new URL('https://example.com');
const isJapikey = shouldAuthenticate(my_auth_token, issuer);
```
