# Unreleased

## Breaking Changes

- New API keys are now signed with ES256 (ECDSA P-256) instead of RS256, and are version 2 (`ver: "japikey-v2"`).
- The public JWKs of new keys now include `ver: 2` and `alg: "ES256"`. They are stored and served from `.well-known/jwks.json` this way. No database schema change is needed.
- `authenticate()` now picks the signing algorithm from the token's version (v1 is RS256, v2 is ES256), instead of always requiring RS256.
- `ver` values of `japikey-v0` are no longer accepted.
- The shared `ALG` is now `ES256`. A new `ALG_BY_VER` map gives the algorithm of every version.

## Compatibility

- Existing version 1 (RS256) keys keep working, with no changes to their stored JWKs (which have no `ver` or `alg`).
- Version 1 keys and version 2 keys can be stored in the same table.

# Version 0.4.1
Update all dependencies to the latest versions. Also the individual packages properly declare which dependencies they require

## Breaking Changes
- Cloudflare peer type updated to 5.x

# Version 0.4.0

## Breaking Changes

- The return type for `shouldAuthenticate` changed from Promise<boolean> to boolean

## New features

- The update-version.sh bumper script now works for macs, and it runs npm install. It doesn't remember to update the changelog though :)

# Version 0.3.2

Fixes a bug in the d1 driver causing ensureTable() to fail because the statement is multi-line

# Version 0.3.1

This improves the typescript types for the cloudflare package, for compatibility with types in your worker.
@cloudflare/workers-types is made into a peerDep so the exact version will match.
Next, to avoid using global vars (request/response), they are imported directly from cloudflare
Finally, the generics are properly passed down to the request and response objects

# Version 0.3.0

## Breaking Changes

- Updated the CreateJwksRouter to take in an options parameter, rather than just the db
- Renamed the options for the API router from `CreateApiKeyRouterOptions` to `ApiKeyRouterOptions`
- Renamed `CreateJwksRouterOptions` to `JwksRouterOptions` for the cloudflare router

## New Features

- Added `maxAgeSeconds` option to JWKS router to set Cache-Control max-age on the .well-known/jwks.json response

# Version 0.2.2

This is a documentation-only patch. The README inside @japikey/japikey is no longer a symlink, to allow it to display in npm during publishing. Additionally, there's one small doc bugfix of metadata-> databaseMetadata

# Version 0.2.1

This is the initial, working release of japikey. It contains:

- @japikey/japikey - Core package for creating an API key
- @japikey/authenticate - Package for decoding an API key and determining if it is valid (can also be run on the client-side)
- @japikey/shared - Common interfaces and errors used through the ecosystem
- @japikey/experss - Express routes that implement the full japikey endpoints
- @japikey/cloudflare - Cloudflare Worker routes that implement the full japikey endpoints
- @japikey/sqlite - Sqlite adapter for saving your apikey information in sql
