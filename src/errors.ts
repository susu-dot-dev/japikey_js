import type { STATUS_CODES } from 'http';

type StatusCode = keyof typeof STATUS_CODES;
export enum errorType {
  UNKNOWN = 'unknown',
  INCORRECT_USAGE = 'incorrect_usage',
  SIGNING_ERROR = 'signing_error',
  MALFORMED_TOKEN = 'malformed_token',
  UNAUTHORIZED = 'unauthorized',
}

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

/**
 * When authenticating a token, any initial validation error for parsing
 * becomes a 401- MalformedTokenError.
 * This includes things like: missing token, not a JWT, missing kid etc
 * Once the token is verified, other errors become 403-level errors
 */
export class MalformedTokenError extends JapikeyError {
  constructor(message: string, options?: ErrorOptions) {
    super(
      401,
      errorType.MALFORMED_TOKEN,
      'The token is missing or not in the correct format',
      options
    );
  }
}

/**
 * When authenticating a token, if the token can be parsed, but access is not granted,
 * a 403 Unauthorized error is thrown
 */
export class UnauthorizedError extends JapikeyError {
  constructor(message: string, options?: ErrorOptions) {
    super(403, errorType.UNAUTHORIZED, message, options);
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
  constructor(message: string, type: errorType, options?: ErrorOptions) {
    super(500, type, message, options);
  }
}

/**
 * This error represents any uncaught exception. If this occurs, it implies that the library
 * needs to be more rigorous around error handling and wrapping the error with an appropriate type.
 */
export class UnknownError extends JapikeyError {
  constructor(message: string, options?: ErrorOptions) {
    super(500, errorType.UNKNOWN, message, options);
  }
}

/**
 * Represents any error generated while trying to sign the JWT
 */
export class SigningError extends UnexpectedError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, errorType.SIGNING_ERROR, options);
  }
}

export class IncorrectUsageError extends UnexpectedError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, errorType.INCORRECT_USAGE, options);
  }
}
