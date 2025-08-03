import type { STATUS_CODES } from 'http';

type StatusCode = keyof typeof STATUS_CODES;
export enum errorType {
  UNKNOWN = 'unknown',
  INCORRECT_USAGE = 'incorrect_usage',
  INVALID_INPUT = 'invalid_input',
  SIGNING_ERROR = 'signing_error',
}

export class JapikeyError extends Error {
  constructor(
    public code: StatusCode,
    public data: Record<string, unknown> & { type: errorType },
    message?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }

  body(): string {
    return JSON.stringify(this.data);
  }
}

/**
 * This is a base class errors for all known, but unexpected error types
 * These type of errors are known to be possible, but should not happen in normal behavior
 * These errors should generally not be triggered by invalid input.
 * The only other class of 500-level errors is the UnknownError, which would be for any exception
 * which is otherwise uncaught.
 */
export class UnexpectedError extends JapikeyError {
  constructor(
    data: Record<string, unknown> & { type: errorType },
    message: string,
    options?: ErrorOptions
  ) {
    super(500, data, message, options);
  }
}

/**
 * This error represents any uncaught exception. If this occurs, it implies that the library
 * needs to be more rigorous around error handling and wrapping the error with an appropriate type.
 */
export class UnknownError extends JapikeyError {
  constructor(message: string, options?: ErrorOptions) {
    super(500, { type: errorType.UNKNOWN }, message, options);
  }
}

export class InvalidInputError extends JapikeyError {
  constructor(message: string, options?: ErrorOptions) {
    super(400, { type: errorType.INVALID_INPUT }, message, options);
  }
}

/**
 * Represents any error generated while trying to sign the JWT
 */
export class SigningError extends UnexpectedError {
  constructor(message: string, options?: ErrorOptions) {
    super({ type: errorType.SIGNING_ERROR }, message, options);
  }
}

export class IncorrectUsageError extends UnexpectedError {
  constructor(message: string, options?: ErrorOptions) {
    super({ type: errorType.INCORRECT_USAGE }, message, options);
  }
}
