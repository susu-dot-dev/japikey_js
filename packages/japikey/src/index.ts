import { createApiKey } from './sign.ts';
import type { CreateApiKeyOptions, CreateApiKeyResult } from './sign.ts';
import type { ApiKeyRow, DatabaseDriver } from './database/interface.ts';
import { TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS } from './database/interface.ts';
import SqliteDriver, { toSqlite, fromSqlite } from './database/sqlite.ts';
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
  toSqlite,
  fromSqlite,
  TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS,
  type ApiKeyRow,
  type CreateApiKeyOptions,
  type CreateApiKeyResult,
  type DatabaseDriver,
  type JSONWebKeySet,
};
