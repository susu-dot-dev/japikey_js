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
