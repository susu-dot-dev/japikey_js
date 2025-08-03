import * as jose from 'jose';
import { v7 as uuidv7 } from 'uuid';
import { URL } from 'node:url';
import {
  JapikeyError,
  IncorrectUsageError,
  SigningError,
  UnknownError,
} from './errors.ts';

export type CreateApiKeyOptions = {
  sub: string;
  iss: URL;
  aud: string;
  expiresAt: Date;
};

export type CreateApiKeyResult = {
  jwks: jose.JSONWebKeySet;
  jwt: string;
};

async function generateKeyPair(
  alg: string
): Promise<jose.GenerateKeyPairResult> {
  try {
    const { publicKey, privateKey } = await jose.generateKeyPair(alg);
    return { publicKey, privateKey };
  } catch (err) {
    throw new SigningError('Failed to generate key pair', { cause: err });
  }
}

function getExpiresAt(expiresAt: Date): number {
  if (expiresAt.getTime() < 0) {
    throw new IncorrectUsageError('expiresAt must be in the future');
  }
  return Math.floor(expiresAt.getTime() / 1000);
}

function getSub(options: CreateApiKeyOptions): string {
  if (!options.sub) {
    throw new IncorrectUsageError('sub must be a non-empty string');
  }
  return options.sub;
}

async function signJWT(
  payload: jose.JWTPayload,
  privateKey: jose.CryptoKey,
  alg: string,
  kid: string
): Promise<string> {
  try {
    const jwt = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg, kid })
      .setIssuedAt()
      .sign(privateKey);
    return jwt;
  } catch (err) {
    throw new SigningError('Failed to sign JWT', { cause: err });
  }
}

async function generateJWKS(
  publicKey: jose.CryptoKey,
  kid: string
): Promise<jose.JSONWebKeySet> {
  let jwk: jose.JWK;
  try {
    jwk = await jose.exportJWK(publicKey);
  } catch (err) {
    throw new SigningError('Failed to generate JWKS', { cause: err });
  }
  jwk.kid = kid;
  return { keys: [jwk] };
}

export async function createApiKey(
  claims: jose.JWTPayload,
  options: CreateApiKeyOptions
): Promise<CreateApiKeyResult> {
  try {
    const kid = uuidv7();
    const alg = 'RS256';
    const exp = getExpiresAt(options.expiresAt);
    const iss = new URL(kid, options.iss).toString();
    const sub = getSub(options);
    const aud = options.aud;
    const { publicKey, privateKey } = await generateKeyPair(alg);
    const jwks = await generateJWKS(publicKey, kid);

    const overrides: jose.JWTPayload = { sub, iss, aud, exp };

    const jwt = await signJWT(
      { ...claims, ...overrides },
      privateKey,
      alg,
      kid
    );
    return { jwks, jwt };
  } catch (err) {
    if (err instanceof JapikeyError) {
      throw err;
    }
    throw new UnknownError('Failed to create API key', { cause: err });
  }
}
