import { vi, beforeEach, Mock } from 'vitest';
import * as jose from 'jose';
vi.mock('jose', async () => {
  const actual: typeof jose = await vi.importActual('jose');
  return {
    ...actual,
    generateKeyPair: vi.fn(),
    exportJWK: vi.fn(),
    SignJWT: vi.fn(),
  };
});

beforeEach(async () => {
  const actual: typeof jose = await vi.importActual('jose');
  (jose.generateKeyPair as Mock).mockImplementation(actual.generateKeyPair);
  (jose.exportJWK as Mock).mockImplementation(actual.exportJWK);
  (jose.SignJWT as Mock).mockImplementation((payload: jose.JWTPayload) => {
    return new actual.SignJWT(payload);
  });
});
