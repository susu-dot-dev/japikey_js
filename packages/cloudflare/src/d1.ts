import type { ApiKeyRow, DatabaseDriver } from '@japikey/japikey';
import {
  TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS,
  IncorrectUsageError,
  DatabaseError,
  toSqlite,
  fromSqlite,
} from '@japikey/japikey';
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
      await this.db.exec(`
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
      await query.bind(params).run();
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
      result = await query.bind({ kid }).first();
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
      response = await query
        .bind({
          user_id,
          limit: limit ?? -1,
          offset: offset ?? 0,
        })
        .all();
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
      await query.bind(filter).run();
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
