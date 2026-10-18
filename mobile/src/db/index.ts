import { openDatabaseAsync } from 'expo-sqlite';
import { migrate, type SqlDb } from './schema';

let dbPromise: Promise<SqlDb> | null = null;

/** The app's single SQLite database, opened and migrated once. */
export function getDb(): Promise<SqlDb> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await openDatabaseAsync('football-analytics.db');
      await db.execAsync('PRAGMA journal_mode = WAL;');
      const sqlDb = db as unknown as SqlDb;
      await migrate(sqlDb);
      return sqlDb;
    })().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}
