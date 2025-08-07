# @japikey/shared

This package contains definitions and errors used throughout the japikey ecosystem. Some of these definitions are re-exported from @japikey/japikey for convenience. You can use either import as desired.

This package is part of the @japikey constellation of packages. See @japikey/japikey for more details

# Error handling

All exceptions in the japikey ecosystem are wrapped in a defined set of errors. This lets you have specific error handling code depending on the type of error (even if it's from an underlying library (e.g. jose)). The errors are also aimed at being HTTP-endpoint friendly. They contain an HTTP status code, and the endpoint libraries are equipped to turn these errors into proper, JSON-based responses

All errors derive from JapikeyError:

```ts
export class JapikeyError extends Error {
  constructor(
    public code: StatusCode,
    public errorType: errorType,
    message?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}
```

Other error types just help to refine the code, errorType.

# Database utilities

The shared library also defines the interface for all of the Database drivers. Any driver wishing to easily interact with japikey must implement these methods:

```ts
export type DatabaseDriver = {
  ensureTable: () => Promise<void>;
  insertApiKey: (apiKey: ApiKeyRow) => Promise<void>;
  getApiKey: (kid: string) => Promise<ApiKeyRow | null>;
  findApiKeys: (
    user_id: string,
    limit?: number,
    offset?: number
  ) => Promise<ApiKeyRow[]>;
  revokeApiKey: (filter: { user_id: string; kid: string }) => Promise<void>;
  close: () => Promise<void>;
  [TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS]: () => Promise<void>;
};
```
