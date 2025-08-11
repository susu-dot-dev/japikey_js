import type { ApiKeyRow, DatabaseDriver } from '@japikey/shared';
import {
  IncorrectUsageError,
  DatabaseError,
  InvalidInputError,
  TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS,
} from '@japikey/shared';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '@cloudflare/workers-types';

type Queries = {
  insert: D1PreparedStatement;
  get: D1PreparedStatement;
  find: D1PreparedStatement;
  revoke: D1PreparedStatement;
};

function toSqlite(apiKey: ApiKeyRow): Record<keyof ApiKeyRow, unknown> {
  try {
    return {
      kid: apiKey.kid,
      user_id: apiKey.user_id,
      revoked: apiKey.revoked ? 1 : 0,
      jwk: JSON.stringify(apiKey.jwk),
      metadata: JSON.stringify(apiKey.metadata),
    };
  } catch (err) {
    throw new InvalidInputError('Failed to serialize the metadata', {
      cause: err,
    });
  }
}

function fromSqlite(result: Record<keyof ApiKeyRow, unknown>): ApiKeyRow {
  try {
    return {
      kid: result.kid as string,
      user_id: result.user_id as string,
      revoked: result.revoked === 1,
      jwk: JSON.parse(result.jwk as string),
      metadata: JSON.parse(result.metadata as string),
    };
  } catch (err) {
    throw new DatabaseError('Failed to deserialize an ApiKeyRow', {
      cause: err,
    });
  }
}

export default class D1Driver implements DatabaseDriver {
  private _queries?: Queries;
  private tableName: string;

  constructor(
    private db: D1Database,
    tableName: string = 'japikeys'
  ) {
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new IncorrectUsageError('Invalid table name');
    }
    this.tableName = tableName;
  }

  private getQuery(name: keyof Queries): D1PreparedStatement {
    if (!this._queries) {
      throw new IncorrectUsageError(
        'Database not initialized. Call ensureTable() first.'
      );
    }
    return this._queries[name];
  }

  private prepareStatements(): void {
    try {
      this._queries = {
        insert: this.db.prepare(
          `INSERT INTO ${this.tableName} (kid, user_id, revoked, jwk, metadata) VALUES (?1, ?2, ?3, ?4, ?5);`
        ),
        get: this.db.prepare(`SELECT * FROM ${this.tableName} WHERE kid = ?1;`),
        find: this.db.prepare(
          `SELECT * FROM ${this.tableName} WHERE user_id = ?1 LIMIT ?2 OFFSET ?3;`
        ),
        revoke: this.db.prepare(
          `UPDATE ${this.tableName} SET revoked = 1 WHERE user_id = ?1 AND kid = ?2;`
        ),
      };
    } catch (err) {
      throw new DatabaseError('Failed to generate sql prepared statements', {
        cause: err,
      });
    }
  }

  async ensureTable(): Promise<void> {
    try {
      await this.db.exec(
        `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        kid TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        revoked INTEGER NOT NULL,
        jwk TEXT NOT NULL,
        metadata TEXT NOT NULL
      );
    `.replaceAll('\n', ' ') // Workaround for https://github.com/cloudflare/workers-sdk/issues/9133
      );
    } catch (err) {
      throw new DatabaseError('Failed to create the table', {
        cause: err,
      });
    }
    this.prepareStatements();
  }

  async insertApiKey(apiKey: ApiKeyRow): Promise<void> {
    const params = toSqlite(apiKey);
    const query = this.getQuery('insert');
    try {
      await query
        .bind(
          params.kid,
          params.user_id,
          params.revoked,
          params.jwk,
          params.metadata
        )
        .run();
    } catch (err) {
      throw new DatabaseError('Failed to insert api key', {
        cause: err,
      });
    }
  }

  async getApiKey(kid: string): Promise<ApiKeyRow | null> {
    let result: Record<string, unknown> | undefined | null;
    const query = this.getQuery('get');
    try {
      result = await query.bind(kid).first();
    } catch (err) {
      throw new DatabaseError('Failed to query for the api key', {
        cause: err,
      });
    }
    if (!result) {
      return null;
    }
    return fromSqlite(result);
  }

  async findApiKeys(
    user_id: string,
    limit?: number,
    offset?: number
  ): Promise<ApiKeyRow[]> {
    let response: D1Result<Record<string, unknown>>;
    const query = this.getQuery('find');
    try {
      response = await query.bind(user_id, limit ?? -1, offset ?? 0).all();
    } catch (err) {
      throw new DatabaseError('Failed to query for the api keys', {
        cause: err,
      });
    }
    return response.results.map(row => fromSqlite(row));
  }

  async revokeApiKey(filter: { user_id: string; kid: string }): Promise<void> {
    const query = this.getQuery('revoke');
    try {
      await query.bind(filter.user_id, filter.kid).run();
    } catch (err) {
      throw new DatabaseError('Failed to revoke the api key', {
        cause: err,
      });
    }
  }

  async close(): Promise<void> {}

  async [TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS](): Promise<void> {
    await this.db.exec(`DELETE FROM ${this.tableName}`);
  }
}
