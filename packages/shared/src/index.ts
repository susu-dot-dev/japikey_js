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

export const ALG = 'RS256';
export const VER_PREFIX = 'japikey-v';
export const VER_NUM = 1;
export const VER = `${VER_PREFIX}${VER_NUM}`;

export { appendPathToUrl };
