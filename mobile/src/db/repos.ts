import type { Fixture, ProviderId } from '@/domain/types';
import type { OddsQuote } from '@/engine/odds';
import { bestQuotes, isValidDecimalOdds } from '@/engine/odds';
import type { MatchPrediction } from '@/engine/predict';
import { findEstimate } from '@/engine/markets';
import { parseSelectionKey, settle, type Outcome } from '@/engine/settlement';
import type { SlipLeg } from '@/engine/slip';
import type { CacheEntry, CacheStore } from '@/providers/cache';
import type { ManualOddsRow, ManualOddsSource } from '@/providers/odds/manual';
import type { SqlDb } from './schema';

// ---------------------------------------------------------------- cache

interface CacheRow {
  key: string;
  payload: string;
  fetched_at: number;
  etag: string | null;
  provider: string;
  absent: number;
}

export class SqliteCacheStore implements CacheStore {
  constructor(private readonly db: SqlDb) {}

  async get(key: string): Promise<CacheEntry | null> {
    const r = await this.db.getFirstAsync<CacheRow>('SELECT * FROM cache WHERE key = ?', [key]);
    return r ? { key: r.key, payload: r.payload, fetchedAt: r.fetched_at, etag: r.etag, provider: r.provider as ProviderId, absent: r.absent === 1 } : null;
  }

  async set(e: CacheEntry): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO cache (key, payload, fetched_at, etag, provider, absent) VALUES (?, ?, ?, ?, ?, ?)',
      [e.key, e.payload, e.fetchedAt, e.etag, e.provider, e.absent ? 1 : 0],
    );
  }

  async clear(): Promise<void> {
    await this.db.runAsync('DELETE FROM cache', []);
  }

  async stats() {
    const r = await this.db.getFirstAsync<{ n: number; bytes: number | null }>('SELECT COUNT(*) AS n, SUM(LENGTH(payload)) AS bytes FROM cache', []);
    return { entries: r?.n ?? 0, bytes: r?.bytes ?? 0 };
  }
}

// ---------------------------------------------------------------- favourites

export async function listFavorites(db: SqlDb): Promise<Fixture[]> {
  const rows = await db.getAllAsync<{ fixture_json: string }>('SELECT fixture_json FROM favorites ORDER BY created_at DESC', []);
  return rows.flatMap((r) => {
    try {
      return [JSON.parse(r.fixture_json) as Fixture];
    } catch {
      return [];
    }
  });
}

export async function setFavorite(db: SqlDb, fixture: Fixture, favorite: boolean, now: number): Promise<void> {
  if (favorite) {
    await db.runAsync('INSERT OR REPLACE INTO favorites (fixture_id, fixture_json, created_at) VALUES (?, ?, ?)', [fixture.id, JSON.stringify(fixture), now]);
  } else {
    await db.runAsync('DELETE FROM favorites WHERE fixture_id = ?', [fixture.id]);
  }
}

export async function isFavorite(db: SqlDb, fixtureId: string): Promise<boolean> {
  return !!(await db.getFirstAsync<{ fixture_id: string }>('SELECT fixture_id FROM favorites WHERE fixture_id = ?', [fixtureId]));
}

// ---------------------------------------------------------------- predictions

/** Selections stored in every snapshot: the core markets with a full complementary set. */
export const SNAPSHOT_KEYS = ['1X2:H', '1X2:D', '1X2:A', 'OU:1.5:O', 'OU:1.5:U', 'OU:2.5:O', 'OU:2.5:U', 'OU:3.5:O', 'OU:3.5:U', 'BTTS:Y', 'BTTS:N'];

export interface PredictionRow {
  id: number;
  fixture_id: string;
  competition: string;
  season: string;
  home: string;
  away: string;
  kickoff_utc: number | null;
  match_date: string;
  created_at: number;
  snapshot_source: 'auto' | 'manual';
  data_as_of: string | null;
  source_fetched_at: number | null;
  model_version: string;
  market: string;
  selection_key: string;
  probability: number;
  confidence_score: number | null;
  quality_score: number | null;
  odds: number | null;
  odds_provider: string | null;
  odds_bookmaker: string | null;
  odds_quoted_at: number | null;
  outcome: Outcome | 'void' | null;
  final_home: number | null;
  final_away: number | null;
  ht_home: number | null;
  ht_away: number | null;
  settled_at: number | null;
  settled_by: string | null;
}

export class SnapshotRejected extends Error {
  constructor(readonly reason: 'started' | 'demo' | 'invalid' | 'duplicate') {
    super(`Prediction snapshot rejected: ${reason}`);
  }
}

/**
 * Store an immutable snapshot of the model's probabilities for a match that has
 * not started. Automatic snapshots are taken once per fixture and model version;
 * manual ones always add a new snapshot and never replace an old one.
 */
export async function recordPrediction(
  db: SqlDb,
  fixture: Fixture,
  prediction: MatchPrediction,
  quotes: OddsQuote[],
  now: number,
  source: 'auto' | 'manual',
): Promise<number> {
  if (fixture.isDemo) throw new SnapshotRejected('demo');
  if (fixture.status !== 'scheduled' || (fixture.kickoffUtc !== null && fixture.kickoffUtc <= now)) throw new SnapshotRejected('started');
  if (prediction.issues.length > 0) throw new SnapshotRejected('invalid');
  if (source === 'auto') {
    const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM predictions WHERE fixture_id = ? AND model_version = ? LIMIT 1', [fixture.id, prediction.modelVersion]);
    if (existing) throw new SnapshotRejected('duplicate');
  }
  const best = bestQuotes(quotes, now, fixture.kickoffUtc);
  let inserted = 0;
  await db.withTransactionAsync(async () => {
    for (const key of SNAPSHOT_KEYS) {
      const est = findEstimate(prediction.book, key);
      if (!est) continue;
      const q = best.get(key);
      await db.runAsync(
        `INSERT INTO predictions (fixture_id, competition, season, home, away, kickoff_utc, match_date, created_at, snapshot_source,
          data_as_of, source_fetched_at, model_version, market, selection_key, probability, confidence_score, quality_score,
          odds, odds_provider, odds_bookmaker, odds_quoted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fixture.id,
          fixture.competition,
          fixture.season,
          fixture.home.name,
          fixture.away.name,
          fixture.kickoffUtc,
          fixture.sourceDate,
          now,
          source,
          prediction.dataAsOf,
          prediction.sourceFetchedAt,
          prediction.modelVersion,
          est.selection.market,
          key,
          est.probability,
          prediction.confidence.score,
          prediction.quality.score,
          q?.decimal ?? null,
          q?.provider ?? null,
          q?.bookmaker ?? null,
          q?.quotedAt ?? null,
        ],
      );
      inserted++;
    }
  });
  return inserted;
}

export async function listPredictions(db: SqlDb): Promise<PredictionRow[]> {
  return db.getAllAsync<PredictionRow>('SELECT * FROM predictions ORDER BY created_at DESC, id ASC', []);
}

export async function pendingPredictions(db: SqlDb, now: number): Promise<PredictionRow[]> {
  return db.getAllAsync<PredictionRow>(
    `SELECT * FROM predictions WHERE outcome IS NULL AND (kickoff_utc IS NULL OR kickoff_utc < ?) ORDER BY match_date`,
    [now - 2 * 3_600_000],
  );
}

export interface FinalResult {
  status: Fixture['status'];
  ft?: { home: number; away: number };
  ht?: { home: number; away: number };
}

/** Settle snapshots from a source result. Only settlement columns are written. */
export async function settlePredictionRows(db: SqlDb, rows: PredictionRow[], result: FinalResult, now: number, settledBy: ProviderId): Promise<number> {
  let n = 0;
  for (const row of rows) {
    let outcome: Outcome | 'void' | null = null;
    if (result.status === 'cancelled' || result.status === 'abandoned') outcome = 'void';
    else if (result.status === 'finished' && result.ft) {
      const sel = parseSelectionKey(row.selection_key);
      outcome = sel ? settle(sel, result.ft, result.ht) : null;
    }
    if (!outcome) continue;
    await db.runAsync(
      'UPDATE predictions SET outcome = ?, final_home = ?, final_away = ?, ht_home = ?, ht_away = ?, settled_at = ?, settled_by = ? WHERE id = ? AND outcome IS NULL',
      [outcome, result.ft?.home ?? null, result.ft?.away ?? null, result.ht?.home ?? null, result.ht?.away ?? null, now, settledBy, row.id],
    );
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- manual odds

export class SqliteManualOdds implements ManualOddsSource {
  constructor(private readonly db: SqlDb) {}

  async list(fixtureId: string): Promise<ManualOddsRow[]> {
    const rows = await this.db.getAllAsync<{ selection_key: string; decimal: number; entered_at: number }>(
      'SELECT selection_key, decimal, entered_at FROM manual_odds WHERE fixture_id = ?',
      [fixtureId],
    );
    return rows.map((r) => ({ selectionKey: r.selection_key, decimal: r.decimal, enteredAt: r.entered_at }));
  }

  async set(fixtureId: string, selectionKey: string, decimal: number, now: number): Promise<void> {
    if (!isValidDecimalOdds(decimal)) throw new RangeError('Invalid decimal odds');
    await this.db.runAsync('INSERT OR REPLACE INTO manual_odds (fixture_id, selection_key, decimal, entered_at) VALUES (?, ?, ?, ?)', [fixtureId, selectionKey, decimal, now]);
  }

  async remove(fixtureId: string, selectionKey: string): Promise<void> {
    await this.db.runAsync('DELETE FROM manual_odds WHERE fixture_id = ? AND selection_key = ?', [fixtureId, selectionKey]);
  }
}

// ---------------------------------------------------------------- slips

export interface SlipRow {
  id: number;
  name: string;
  stake: number;
  created_at: number;
  combined_odds: number | null;
  combined_probability: number | null;
  probability_method: string | null;
}

interface LegRow {
  id: number;
  slip_id: number;
  fixture_id: string;
  competition: string;
  home: string;
  away: string;
  kickoff_utc: number | null;
  match_date: string | null;
  selection_key: string;
  probability: number | null;
  odds: number | null;
  odds_provider: string | null;
  odds_bookmaker: string | null;
  odds_quoted_at: number | null;
  outcome: Outcome | null;
  outcome_source: string | null;
  settled_at: number | null;
}

export interface SavedLeg extends SlipLeg {
  id: number;
  matchDate: string | null;
  outcomeSource: string | null;
}

export interface SavedSlip extends SlipRow {
  legs: SavedLeg[];
}

const toLeg = (r: LegRow): SavedLeg => ({
  id: r.id,
  fixtureId: r.fixture_id,
  competition: r.competition,
  home: r.home,
  away: r.away,
  kickoffUtc: r.kickoff_utc,
  matchDate: r.match_date,
  selectionKey: r.selection_key,
  probability: r.probability,
  odds: r.odds,
  oddsProvider: r.odds_provider as ProviderId | null,
  oddsBookmaker: r.odds_bookmaker,
  oddsQuotedAt: r.odds_quoted_at,
  outcome: r.outcome,
  outcomeSource: r.outcome_source,
});

export async function saveSlip(
  db: SqlDb,
  slip: { name: string; stake: number; combinedOdds: number | null; combinedProbability: number | null; probabilityMethod: string | null },
  legs: (SlipLeg & { matchDate: string | null })[],
  now: number,
): Promise<number> {
  let id = 0;
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(
      'INSERT INTO slips (name, stake, created_at, combined_odds, combined_probability, probability_method) VALUES (?, ?, ?, ?, ?, ?)',
      [slip.name, slip.stake, now, slip.combinedOdds, slip.combinedProbability, slip.probabilityMethod],
    );
    id = r.lastInsertRowId;
    for (const l of legs) {
      await db.runAsync(
        `INSERT INTO slip_legs (slip_id, fixture_id, competition, home, away, kickoff_utc, match_date, selection_key, probability, odds, odds_provider, odds_bookmaker, odds_quoted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, l.fixtureId, l.competition, l.home, l.away, l.kickoffUtc, l.matchDate, l.selectionKey, l.probability, l.odds, l.oddsProvider, l.oddsBookmaker, l.oddsQuotedAt],
      );
    }
  });
  return id;
}

export async function listSlips(db: SqlDb): Promise<SavedSlip[]> {
  const slips = await db.getAllAsync<SlipRow>('SELECT * FROM slips ORDER BY created_at DESC', []);
  const legs = await db.getAllAsync<LegRow>('SELECT * FROM slip_legs ORDER BY id', []);
  return slips.map((s) => ({ ...s, legs: legs.filter((l) => l.slip_id === s.id).map(toLeg) }));
}

export async function setLegOutcome(db: SqlDb, legId: number, outcome: Outcome | null, source: 'source' | 'manual', now: number = Date.now()): Promise<void> {
  await db.runAsync('UPDATE slip_legs SET outcome = ?, outcome_source = ?, settled_at = ? WHERE id = ?', [outcome, outcome ? source : null, outcome ? now : null, legId]);
}

export async function deleteSlip(db: SqlDb, id: number): Promise<void> {
  await db.runAsync('DELETE FROM slip_legs WHERE slip_id = ?', [id]);
  await db.runAsync('DELETE FROM slips WHERE id = ?', [id]);
}
