import { describe, test, expect } from 'vitest';
import {
  errorType,
  UnknownError,
  JapikeyError,
  InvalidInputError,
  IncorrectUsageError,
  SigningError,
} from '../src/errors';
describe('Errors', () => {
  const sampleData = { hello: 'world', meaning: 42 };
  const tests: { err: JapikeyError; code: number; errorType: errorType }[] = [
    { err: new UnknownError('test'), code: 500, errorType: errorType.UNKNOWN },
    {
      err: new IncorrectUsageError('test'),
      code: 500,
      errorType: errorType.INCORRECT_USAGE,
    },
    {
      err: new InvalidInputError('test'),
      code: 400,
      errorType: errorType.INVALID_INPUT,
    },
    {
      err: new SigningError('test'),
      code: 500,
      errorType: errorType.SIGNING_ERROR,
    },
  ];
  test.each(tests)(
    'Check Error type $errorType',
    ({ err, code, errorType }) => {
      expect(err).toBeInstanceOf(JapikeyError);
      expect(err.code).toBe(code);
      expect(err.errorType).toBe(errorType);
    }
  );
});
