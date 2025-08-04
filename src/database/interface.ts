import type * as jose from 'jose';

export type ApiKeyRow = {
  kid: string;
  user_id: string;
  revoked: boolean;
  jwk: jose.JWK;
  metadata: Record<string, unknown>;
};

export const TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS = Symbol(
  'TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS'
);

export type DatabaseOperations = {
  ensureTable: () => Promise<void>;
  insertApiKey: (apiKey: ApiKeyRow) => Promise<void>;
  getApiKey: (kid: string) => Promise<ApiKeyRow | null>;
  findApiKeys: (
    user_id: string,
    limit?: number,
    offset?: number
  ) => Promise<ApiKeyRow[]>;
  revokeApiKey: (filter: { user_id: string; kid: string }) => Promise<void>;
  shutdown: () => Promise<void>;
  [TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS]: () => Promise<void>;
};
