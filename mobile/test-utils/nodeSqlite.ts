import type { BindValue, SqlDb } from '@/db/schema';

interface Statement {
  run(...params: BindValue[]): { lastInsertRowid: number | bigint; changes: number | bigint };
  all(...params: BindValue[]): unknown[];
  get(...params: BindValue[]): unknown;
}
interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): Statement;
}

/** SqlDb backed by Node's built-in SQLite, so repository tests run real SQL (triggers included). */
export function openTestDb(): SqlDb {
  const getBuiltin = (process as unknown as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule;
  const { DatabaseSync } = getBuiltin('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSync };
  const db = new DatabaseSync(':memory:');
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params) {
      const r = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async getAllAsync<T>(sql: string, params: BindValue[]) {
      return db.prepare(sql).all(...params).map((row) => ({ ...(row as object) })) as T[];
    },
    async getFirstAsync<T>(sql: string, params: BindValue[]) {
      const row = db.prepare(sql).get(...params);
      return (row ? { ...(row as object) } : null) as T | null;
    },
    async withTransactionAsync(task) {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
