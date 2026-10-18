import { migrate, type SqlDb } from '@/db/schema';
import { openTestDb } from './nodeSqlite';

let db: Promise<SqlDb> | null = null;

/** One migrated in-memory database per test file (Jest isolates module state per file). */
export function getTestDb(): Promise<SqlDb> {
  db ??= (async () => {
    const d = openTestDb();
    await migrate(d);
    return d;
  })();
  return db;
}
