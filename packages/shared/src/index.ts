import { appendPathToUrl } from './util.ts';
export {
  JapikeyError,
  InvalidInputError,
  MalformedTokenError,
  UnauthorizedError,
  NotFoundError,
  UnexpectedError,
  UnknownError,
  SigningError,
  IncorrectUsageError,
  DatabaseError,
  errorType,
} from './errors.ts';

export * from './database.ts';

export const VER_PREFIX = 'japikey-v';
export const VER_NUM = 2;
export const VER = `${VER_PREFIX}${VER_NUM}`;

/**
 * The JWT signing algorithm for each API key version. The version in a token
 * selects which algorithm it is verified with, so older keys keep working until
 * clients upgrade them.
 * - v1: RS256 (no longer minted). Their JWKs have no `ver` or `alg` members
 * - v2: ES256. Their JWKs carry `ver: 2` and `alg: 'ES256'`
 *
 * Every version from 2 onwards MUST write `alg` on its JWK. Algorithms of the
 * same key family (e.g. ES256 and ES384) share a key shape, so `alg` on the
 * JWK is what keeps them apart.
 */
export const ALG_BY_VER: Readonly<Record<number, string>> = {
  1: 'RS256',
  2: 'ES256',
};

/** The algorithm used when minting new API keys (the current version) */
export const ALG = 'ES256';

export { appendPathToUrl };
