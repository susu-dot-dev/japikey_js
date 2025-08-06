import type { ApiKeyRow, DatabaseDriver } from '@japikey/shared';
import {
  IncorrectUsageError,
  InvalidInputError,
  DatabaseError,
  TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS,
} from '@japikey/shared';
import type { StatementSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';
import { DatabaseSync } from 'node:sqlite';

function toSqlite(apiKey: ApiKeyRow): Record<string, SQLInputValue> {
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

function fromSqlite(result: Record<string, SQLOutputValue>): ApiKeyRow {
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

type Queries = {
  insert: StatementSync;
  get: StatementSync;
  find: StatementSync;
  revoke: StatementSync;
};

export default class SqliteDriver implements DatabaseDriver {
  private db: DatabaseSync;
  private _queries?: Queries;
  private tableName: string;

  constructor(path: string, tableName: string = 'japikeys') {
    this.db = new DatabaseSync(path);
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
      throw new IncorrectUsageError('Invalid table name');
    }
    this.tableName = tableName;
  }

  private getQuery(name: keyof Queries): StatementSync {
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
          `INSERT INTO ${this.tableName} (kid, user_id, revoked, jwk, metadata) VALUES (:kid, :user_id, :revoked, :jwk, :metadata)`
        ),
        get: this.db.prepare(
          `SELECT * FROM ${this.tableName} WHERE kid = :kid`
        ),
        find: this.db.prepare(
          `SELECT * FROM ${this.tableName} WHERE user_id = :user_id LIMIT :limit OFFSET :offset`
        ),
        revoke: this.db.prepare(
          `UPDATE ${this.tableName} SET revoked = 1 WHERE user_id = :user_id AND kid = :kid`
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
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        kid TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        revoked INTEGER NOT NULL,
        jwk TEXT NOT NULL,
        metadata TEXT NOT NULL
      )
    `);
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
      query.run(params);
    } catch (err) {
      throw new DatabaseError('Failed to insert api key', {
        cause: err,
      });
    }
  }

  async getApiKey(kid: string): Promise<ApiKeyRow | null> {
    let result: Record<string, SQLOutputValue> | undefined;
    const query = this.getQuery('get');
    try {
      result = query.get({ kid });
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
    let rows: Record<string, SQLOutputValue>[] | undefined;
    const query = this.getQuery('find');
    try {
      rows = query.all({
        user_id,
        limit: limit ?? -1,
        offset: offset ?? 0,
      });
    } catch (err) {
      throw new DatabaseError('Failed to query for the api keys', {
        cause: err,
      });
    }
    return rows.map(row => fromSqlite(row));
  }

  async revokeApiKey(filter: { user_id: string; kid: string }): Promise<void> {
    const query = this.getQuery('revoke');
    try {
      query.run(filter);
    } catch (err) {
      throw new DatabaseError('Failed to revoke the api key', {
        cause: err,
      });
    }
  }

  async close(): Promise<void> {
    try {
      this.db.close();
    } catch (err) {
      throw new DatabaseError('Failed to close the database', {
        cause: err,
      });
    }
  }

  async [TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS](): Promise<void> {
    this.db.exec(`DELETE FROM ${this.tableName}`);
  }
}
