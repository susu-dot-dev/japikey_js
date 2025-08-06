import { createApiKey } from './sign.ts';
import type { CreateApiKeyOptions, CreateApiKeyResult } from './sign.ts';
import type { DatabaseDriver } from './database/interface.ts';
import SqliteDriver from './database/sqlite.ts';
import type { JSONWebKeySet } from 'jose';
import {
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
} from '@japikey/shared';

export {
  createApiKey,
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
  SqliteDriver,
  type CreateApiKeyOptions,
  type CreateApiKeyResult,
  type DatabaseDriver,
  type JSONWebKeySet,
};
