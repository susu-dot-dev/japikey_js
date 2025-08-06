import {
  describe,
  expect,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type * as jose from 'jose';
import type { DatabaseDriver } from '../src/database/interface.ts';
import { TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS } from '../src/database/interface.ts';
import SqliteDriver from '../src/database/sqlite.ts';
import { createApiKey } from '../src/sign.ts';
import { apiKeyOptions, userClaims } from './testHelpers.ts';
import type { ApiKeyRow } from '../src/database/interface.ts';
import {
  DatabaseError,
  IncorrectUsageError,
  InvalidInputError,
} from '@japikey/shared';
import { unlink } from 'fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Database', () => {
  const driverNames = ['sqlite'];
  let drivers: { name: string; driver: DatabaseDriver }[];
  let userId: string;
  let jwk: jose.JWK;
  let kid: string;
  beforeAll(async () => {
    drivers = [
      {
        name: 'sqlite',
        driver: new SqliteDriver(':memory:'),
      },
    ];

    for (const driver of drivers) {
      await driver.driver.ensureTable();
    }
  });

  afterAll(async () => {
    if (drivers) {
      for (const driver of drivers) {
        await driver.driver.close();
      }
    }
  });

  beforeEach(async () => {
    userId = uuidv4();
    const resp = await createApiKey(userClaims(), apiKeyOptions());
    jwk = resp.jwk;
    kid = resp.kid;
  });

  afterEach(async () => {
    for (const driver of drivers) {
      await driver.driver[TRUNCATE_TABLE_ONLY_USE_FOR_UNIT_TESTS]();
    }
  });

  test.each(driverNames)('%s can insert and get an api key', async name => {
    const driver = drivers.find(d => d.name === name)!.driver;
    const promise = driver.insertApiKey({
      kid: kid,
      user_id: userId,
      revoked: false,
      jwk: jwk,
      metadata: {},
    });
    await expect(promise).resolves.toBeUndefined();
    const apiKey = await driver.getApiKey(kid);
    expect(apiKey).toEqual({
      kid,
      user_id: userId,
      revoked: false,
      jwk: jwk,
      metadata: {},
    });
  });

  test.each(driverNames)(
    '%s returns null if the api key is not found',
    async name => {
      const driver = drivers.find(d => d.name === name)!.driver;
      const apiKey = await driver.getApiKey(kid);
      expect(apiKey).toBeNull();
    }
  );

  test.each(driverNames)('%s can revoke an api key', async name => {
    const driver = drivers.find(d => d.name === name)!.driver;
    const promise = driver.insertApiKey({
      kid,
      user_id: userId,
      revoked: false,
      jwk: jwk,
      metadata: {},
    });
    await expect(promise).resolves.toBeUndefined();
    let apiKey = await driver.getApiKey(kid);
    expect(apiKey).toEqual({
      kid,
      user_id: userId,
      revoked: false,
      jwk: jwk,
      metadata: {},
    });
    await expect(
      driver.revokeApiKey({ user_id: userId, kid })
    ).resolves.toBeUndefined();

    apiKey = await driver.getApiKey(kid);
    expect(apiKey).toEqual({
      kid,
      user_id: userId,
      revoked: true,
      jwk: jwk,
      metadata: {},
    });
  });

  test.each(driverNames)('%s can find api keys for a user', async name => {
    const driver = drivers.find(d => d.name === name)!.driver;

    // Create multiple API keys for the same user
    const apiKey1 = await createApiKey(userClaims(), apiKeyOptions());
    const apiKey2 = await createApiKey(userClaims(), apiKeyOptions());
    const apiKey3 = await createApiKey(userClaims(), apiKeyOptions());

    // Insert the API keys
    await driver.insertApiKey({
      kid: apiKey1.kid,
      user_id: userId,
      revoked: false,
      jwk: apiKey1.jwk,
      metadata: {},
    });
    await driver.insertApiKey({
      kid: apiKey2.kid,
      user_id: userId,
      revoked: true,
      jwk: apiKey2.jwk,
      metadata: { name: 'test-key' },
    });
    await driver.insertApiKey({
      kid: apiKey3.kid,
      user_id: userId,
      revoked: false,
      jwk: apiKey3.jwk,
      metadata: { description: 'another key' },
    });

    // Test finding all API keys for the user
    const apiKeys = await driver.findApiKeys(userId);
    expect(apiKeys).toHaveLength(3);
    expect(apiKeys).toEqual(
      expect.arrayContaining([
        {
          kid: apiKey1.kid,
          user_id: userId,
          revoked: false,
          jwk: apiKey1.jwk,
          metadata: {},
        },
        {
          kid: apiKey2.kid,
          user_id: userId,
          revoked: true,
          jwk: apiKey2.jwk,
          metadata: { name: 'test-key' },
        },
        {
          kid: apiKey3.kid,
          user_id: userId,
          revoked: false,
          jwk: apiKey3.jwk,
          metadata: { description: 'another key' },
        },
      ])
    );

    // Test with limit
    const limitedApiKeys = await driver.findApiKeys(userId, 2);
    expect(limitedApiKeys).toHaveLength(2);

    // Test with offset
    const offsetApiKeys = await driver.findApiKeys(userId, 1, 1);
    expect(offsetApiKeys).toHaveLength(1);

    // Test finding API keys for a different user (should return empty array)
    const otherUserId = uuidv4();
    const otherUserApiKeys = await driver.findApiKeys(otherUserId);
    expect(otherUserApiKeys).toHaveLength(0);
  });

  test.each(driverNames)(
    '%s handles duplicate insertion errors',
    async name => {
      const driver = drivers.find(d => d.name === name)!.driver;

      await driver.insertApiKey({
        kid,
        user_id: userId,
        revoked: false,
        jwk: jwk,
        metadata: {},
      });

      await expect(
        driver.insertApiKey({
          kid,
          user_id: userId,
          revoked: false,
          jwk: jwk,
          metadata: {},
        })
      ).rejects.toThrow('Failed to insert api key');
    }
  );

  test.each(driverNames)('%s handles serialization errors', async name => {
    const driver = drivers.find(d => d.name === name)!.driver;
    const circularReference: { circular?: unknown } = {};
    circularReference.circular = circularReference;
    const apiKey = {
      kid,
      user_id: userId,
      revoked: false,
      jwk: jwk,
      metadata: circularReference,
    };
    await expect(driver.insertApiKey(apiKey)).rejects.toThrow(
      InvalidInputError
    );
  });

  test.each(driverNames)('%s handles database insertion errors', async name => {
    const driver = drivers.find(d => d.name === name)!.driver;
    const badMetadata: Record<string, unknown> = undefined as unknown as Record<
      string,
      unknown
    >;
    const apiKey = {
      kid,
      user_id: userId,
      revoked: false,
      jwk: jwk,
      metadata: badMetadata,
    } as ApiKeyRow;
    await expect(driver.insertApiKey(apiKey)).rejects.toThrow(DatabaseError);
  });
});

describe('SqliteDriver', () => {
  let jwk: jose.JWK;
  let kid: string;
  beforeAll(async () => {
    const response = await createApiKey(userClaims(), apiKeyOptions());
    jwk = response.jwk;
    kid = response.kid;
  });
  const invalidTableNames = [
    '',
    'something with spaces',
    'withpercent%',
    'withdoublequote"',
    'withcomma,',
    'withsemicolon;',
    'withbackslash\\',
    'withnewline\n',
    'withtab\t',
    'withcarriagereturn\r',
    'withnull\0',
    'withbacktick`',
    'withdollar$',
    'withat@',
  ];
  test.each(invalidTableNames)('%s handles invalid table names', async name => {
    expect(() => new SqliteDriver(':memory:', name)).toThrow(
      IncorrectUsageError
    );
  });
  test('throws an error if ensureTable is not called', async () => {
    const driver = new SqliteDriver(':memory:');
    try {
      await expect(
        driver.insertApiKey({
          kid: kid,
          user_id: uuidv4(),
          revoked: false,
          jwk: jwk,
          metadata: {},
        })
      ).rejects.toThrow(IncorrectUsageError);
    } finally {
      await driver.close();
    }
  });

  test('throws an error if the database is closed before calling ensureTable', async () => {
    const driver = new SqliteDriver(':memory:');
    await driver.close();
    await expect(driver.ensureTable()).rejects.toThrow(DatabaseError);
  });

  test('throws an error if the database is closed before calling prepareStatements', async () => {
    const driver = new SqliteDriver(':memory:');
    await driver.ensureTable();
    await driver.close();
    const privateDriver = driver as any;
    expect(() => privateDriver.prepareStatements()).toThrow(DatabaseError);
  });

  test('throws an error if the database is closed before calling insertApiKey', async () => {
    const driver = new SqliteDriver(':memory:');
    await expect(driver.ensureTable()).resolves.toBeUndefined();
    await driver.close();
    await expect(
      driver.insertApiKey({
        kid,
        user_id: uuidv4(),
        revoked: false,
        jwk: jwk,
        metadata: {},
      })
    ).rejects.toThrow(DatabaseError);
  });

  test('throws an error if the database is closed before calling getApiKey', async () => {
    const driver = new SqliteDriver(':memory:');
    await expect(driver.ensureTable()).resolves.toBeUndefined();
    await driver.close();
    await expect(driver.getApiKey(kid)).rejects.toThrow(DatabaseError);
  });

  test('throws an error if the database is closed before calling findApiKeys', async () => {
    const driver = new SqliteDriver(':memory:');
    await expect(driver.ensureTable()).resolves.toBeUndefined();
    await driver.close();
    await expect(driver.findApiKeys(uuidv4())).rejects.toThrow(DatabaseError);
  });

  test('throws an error if the database is closed before calling revokeApiKey', async () => {
    const driver = new SqliteDriver(':memory:');
    await expect(driver.ensureTable()).resolves.toBeUndefined();
    await driver.close();
    await expect(
      driver.revokeApiKey({ user_id: uuidv4(), kid })
    ).rejects.toThrow(DatabaseError);
  });

  test('throws an error if the database is closed twice', async () => {
    const driver = new SqliteDriver(':memory:');
    await expect(driver.ensureTable()).resolves.toBeUndefined();
    await driver.close();
    await expect(driver.close()).rejects.toThrow(DatabaseError);
  });

  test('throws an error if the data cannot be JSON deserialized', async () => {
    const tempFile = join(tmpdir(), `japikey-test-${uuidv4()}.db`);

    try {
      const driver = new SqliteDriver(tempFile);
      await driver.ensureTable();
      await driver.insertApiKey({
        kid,
        user_id: uuidv4(),
        revoked: false,
        jwk: jwk,
        metadata: {},
      });
      await driver.close();

      const db = new DatabaseSync(tempFile);
      // Corrupt the metadata so that parsing it will fail
      db.exec(
        `UPDATE japikeys SET metadata = 'not valid json {' WHERE kid = '${kid}'`
      );
      db.close();

      const newDriver = new SqliteDriver(tempFile);
      await newDriver.ensureTable();

      await expect(newDriver.getApiKey(kid)).rejects.toThrow(DatabaseError);

      await newDriver.close();
    } finally {
      await unlink(tempFile);
    }
  });
});
