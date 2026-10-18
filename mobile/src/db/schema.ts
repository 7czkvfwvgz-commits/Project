export type BindValue = string | number | null;

/** The subset of expo-sqlite's SQLiteDatabase the app uses (also implemented by the test adapter). */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: BindValue[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(sql: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: BindValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/** Ordered migrations; index + 1 is the schema version stored in PRAGMA user_version. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    etag TEXT,
    provider TEXT NOT NULL,
    absent INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS favorites (
    fixture_id TEXT PRIMARY KEY NOT NULL,
    fixture_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fixture_id TEXT NOT NULL,
    competition TEXT NOT NULL,
    season TEXT NOT NULL,
    home TEXT NOT NULL,
    away TEXT NOT NULL,
    kickoff_utc INTEGER,
    match_date TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    snapshot_source TEXT NOT NULL,
    data_as_of TEXT,
    source_fetched_at INTEGER,
    model_version TEXT NOT NULL,
    market TEXT NOT NULL,
    selection_key TEXT NOT NULL,
    probability REAL NOT NULL CHECK (probability >= 0 AND probability <= 1),
    confidence_score INTEGER,
    quality_score INTEGER,
    odds REAL,
    odds_provider TEXT,
    odds_bookmaker TEXT,
    odds_quoted_at INTEGER,
    outcome TEXT,
    final_home INTEGER,
    final_away INTEGER,
    ht_home INTEGER,
    ht_away INTEGER,
    settled_at INTEGER,
    settled_by TEXT
  );
  CREATE INDEX IF NOT EXISTS predictions_fixture ON predictions (fixture_id);
  CREATE INDEX IF NOT EXISTS predictions_outcome ON predictions (outcome);

  -- Historical predictions are never overwritten: only settlement columns may change.
  CREATE TRIGGER IF NOT EXISTS predictions_immutable
  BEFORE UPDATE OF fixture_id, competition, season, home, away, kickoff_utc, match_date, created_at, snapshot_source,
    data_as_of, source_fetched_at, model_version, market, selection_key, probability, confidence_score, quality_score,
    odds, odds_provider, odds_bookmaker, odds_quoted_at ON predictions
  BEGIN
    SELECT RAISE(ABORT, 'predictions are immutable');
  END;

  CREATE TABLE IF NOT EXISTS slips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    stake REAL NOT NULL,
    created_at INTEGER NOT NULL,
    combined_odds REAL,
    combined_probability REAL,
    probability_method TEXT
  );

  CREATE TABLE IF NOT EXISTS slip_legs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slip_id INTEGER NOT NULL REFERENCES slips (id) ON DELETE CASCADE,
    fixture_id TEXT NOT NULL,
    competition TEXT NOT NULL,
    home TEXT NOT NULL,
    away TEXT NOT NULL,
    kickoff_utc INTEGER,
    match_date TEXT,
    selection_key TEXT NOT NULL,
    probability REAL,
    odds REAL,
    odds_provider TEXT,
    odds_bookmaker TEXT,
    odds_quoted_at INTEGER,
    outcome TEXT,
    outcome_source TEXT,
    settled_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS slip_legs_slip ON slip_legs (slip_id);

  CREATE TABLE IF NOT EXISTS manual_odds (
    fixture_id TEXT NOT NULL,
    selection_key TEXT NOT NULL,
    decimal REAL NOT NULL CHECK (decimal >= 1.01 AND decimal <= 1000),
    entered_at INTEGER NOT NULL,
    PRIMARY KEY (fixture_id, selection_key)
  );
  `,
];

export async function migrate(db: SqlDb): Promise<number> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version] as string;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
    });
    version++;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
  return version;
}
