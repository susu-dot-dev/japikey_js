import type { STATUS_CODES } from 'http';

type StatusCode = keyof typeof STATUS_CODES;
export enum errorType {
  UNKNOWN = 'unknown',
}

export class HTTPError extends Error {
  constructor(
    public code: StatusCode,
    public data: Record<string, unknown> & { type: errorType },
    message?: string
  ) {
    super(message);
  }

  body() {
    return JSON.stringify(this.data);
  }
}

export class UnknownError extends HTTPError {
  constructor(message: string) {
    super(500, { type: errorType.UNKNOWN }, message);
  }
}
