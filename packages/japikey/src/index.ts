import { createApiKey } from './sign.ts';
import type { CreateApiKeyOptions, CreateApiKeyResult } from './sign.ts';
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
  DatabaseDriver,
  ApiKeyRow,
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
  type ApiKeyRow,
  type CreateApiKeyOptions,
  type CreateApiKeyResult,
  type DatabaseDriver,
  type JSONWebKeySet,
};
