# @japikey/sqlite

This implements the DatabaseDriver methods for saving and retreiving japikey information from a database. You can either use these methods yourself, or you can pass the driver into existing endpoint library (such as @japikey/express) to handle it for you

This package is part of the @japikey constellation of packages. See @japikey/japikey for more details

# Usage

```ts
import SqliteDriver from '@japikey/sqlite';
const db = new SqliteDriver(':memory:'); // or your path-to-disk
await db.ensureTable();
// More db operations
```
