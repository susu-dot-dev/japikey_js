import { CreateApiKeyOptions } from '../src/sign.ts';

export const iat = Date.now() - 100;
export const baseIssuer = new URL('https://example.com');
export function userClaims() {
  return {
    scopes: ['read', 'write'],
    iat: Math.floor(iat / 1000),
  };
}

export function apiKeyOptions(): CreateApiKeyOptions {
  return {
    sub: 'my-user',
    iss: baseIssuer,
    aud: 'api-key',
    expiresAt: new Date(iat + 1000 * 60 * 60 * 24), // 1 day from now
  };
}
