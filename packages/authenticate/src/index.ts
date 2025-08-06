import * as jose from 'jose';
import { validate as uuidValidate } from 'uuid';
import {
  ALG,
  VER_NUM,
  VER_PREFIX,
  appendPathToUrl,
  errors,
} from '@japikey/shared';

const { MalformedTokenError, UnauthorizedError } = errors;

export type GetJWKS = (data: { kid: string; iss: URL }) => jose.JWTVerifyGetKey;

export type AuthenticateOptions = {
  baseIssuer: URL;
  getJWKS: GetJWKS;
  verifyOptions?: jose.JWTVerifyOptions;
};

function validateIssuer(
  iss: unknown,
  baseIssuer: URL
): { issuerKid: string; iss: string } {
  if (typeof iss !== 'string' || !iss) {
    throw new MalformedTokenError('Missing issuer in token');
  }
  let prefix = baseIssuer.toString();
  if (!prefix.endsWith('/')) {
    prefix += '/';
  }
  if (!iss.startsWith(prefix)) {
    throw new MalformedTokenError('Invalid issuer');
  }
  const issuerKid = iss.slice(prefix.length);
  if (!uuidValidate(issuerKid)) {
    throw new MalformedTokenError('Invalid issuer');
  }
  return { issuerKid, iss };
}

function validateKid(
  issuerKid: string,
  protectedHeader: jose.JoseHeaderParameters
): string {
  if (protectedHeader.kid !== issuerKid) {
    throw new MalformedTokenError('Mismatched kid compared to issuer');
  }
  return issuerKid;
}

function validateVersion(unverified: jose.JWTPayload): number {
  const { ver } = unverified;
  if (typeof ver !== 'string') {
    throw new MalformedTokenError('Invalid version');
  }
  // In the future, consider adding Regep.Escape(VER_PREFIX) once it's accepted into node
  // It's not needed now because VER_PREFIX doesn't contain any regex special characters
  const match = ver.match(new RegExp(`^${VER_PREFIX}(\\d{1,3})$`));
  if (match === null || match.length === 0 || match[1] === undefined) {
    throw new MalformedTokenError('Invalid version');
  }
  const parsed = parseInt(match[1], 10); // The regex prevents this from throwing
  if (parsed > VER_NUM) {
    throw new MalformedTokenError('Invalid version');
  }
  return parsed;
}

export async function shouldAuthenticate(
  token: string,
  baseIssuer: URL
): Promise<boolean> {
  let unverified: jose.JWTPayload;
  let protectedHeader: jose.JoseHeaderParameters;
  try {
    unverified = jose.decodeJwt(token);
    protectedHeader = jose.decodeProtectedHeader(token);
    const { issuerKid } = validateIssuer(unverified.iss, baseIssuer);
    validateKid(issuerKid, protectedHeader);
    validateVersion(unverified);
    return true;
  } catch (err) {
    return false;
  }
}

export function createGetJWKS(
  baseIssuer: URL,
  options?: jose.RemoteJWKSetOptions
): GetJWKS {
  return (data: { iss: URL }) => {
    // Strictly speaking the authenticate() function will also validate the issuer
    // but adding defense-in-depth is a good idea as this is a key part of ensuring
    // security of the feature
    validateIssuer(data.iss.toString(), baseIssuer);
    const url = appendPathToUrl(data.iss, '.well_known/jwks.json');
    return jose.createRemoteJWKSet(url, options);
  };
}

export async function authenticate(
  token: string,
  options: AuthenticateOptions
): Promise<jose.JWTPayload> {
  let unverified: jose.JWTPayload;
  let protectedHeader: jose.JoseHeaderParameters;
  try {
    unverified = jose.decodeJwt(token);
    protectedHeader = jose.decodeProtectedHeader(token);
  } catch (err) {
    throw new MalformedTokenError('Invalid token', { cause: err });
  }
  validateVersion(unverified);
  const { issuerKid, iss } = validateIssuer(unverified.iss, options.baseIssuer);
  const kid = validateKid(issuerKid, protectedHeader);
  try {
    const { payload } = await jose.jwtVerify(
      token,
      options.getJWKS({ kid, iss: new URL(iss) }),
      {
        ...options.verifyOptions,
        algorithms: [ALG],
      }
    );
    return payload;
  } catch (err) {
    throw new UnauthorizedError('Failed to verify token', { cause: err });
  }
}
