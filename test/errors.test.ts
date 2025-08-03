import { describe, it, expect } from 'vitest';
import { errorType, UnknownError, JapikeyError } from '../src/errors';
describe('Errors', () => {
  it('UnknownError', () => {
    const error = new UnknownError('test');
    expect(error).toBeInstanceOf(JapikeyError);
    expect(error.code).toBe(500);
    expect(error.data.type).toBe(errorType.UNKNOWN);
  });
});
