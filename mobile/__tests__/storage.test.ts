import {
  deleteSlip,
  listFavorites,
  listPredictions,
  listSlips,
  pendingPredictions,
  recordPrediction,
  saveSlip,
  setFavorite,
  setLegOutcome,
  settlePredictionRows,
  SNAPSHOT_KEYS,
  SnapshotRejected,
  SqliteCacheStore,
  SqliteManualOdds,
} from '@/db/repos';
import { migrate, MIGRATIONS } from '@/db/schema';
import { fitLeagueModel } from '@/engine/fit';
import { computePerformance } from '@/engine/performance';
import { predictMatch } from '@/engine/predict';
import { openTestDb } from '../test-utils/nodeSqlite';
import { makeTeams, mulberry32, syntheticLeague } from '../test-utils/synthetic';

const NOW = Date.UTC(2026, 0, 10, 9);

function setup() {
  const teams = makeTeams(10, mulberry32(8));
  const { dataset, fixtures } = syntheticLeague([{ season: '2025-26', start: '2025-08-16', teams, playedRounds: 16 }], 1.3, 3);
  const upcoming = fixtures.filter((f) => f.status === 'scheduled');
  const fixture = { ...upcoming[0]!, kickoffUtc: NOW + 86_400_000 };
  const model = fitLeagueModel(dataset, fixture.sourceDate, '2025-26');
  const prediction = predictMatch({ fixture, dataset, model, nowMs: NOW });
  return { fixture, prediction, upcoming };
}

describe('SQLite storage', () => {
  it('migrates idempotently', async () => {
    const db = openTestDb();
    expect(await migrate(db)).toBe(MIGRATIONS.length);
    expect(await migrate(db)).toBe(MIGRATIONS.length);
  });

  it('records an immutable prediction snapshot', async () => {
    const db = openTestDb();
    await migrate(db);
    const { fixture, prediction } = setup();
    const n = await recordPrediction(db, fixture, prediction, [], NOW, 'manual');
    expect(n).toBe(SNAPSHOT_KEYS.length);
    const rows = await listPredictions(db);
    expect(rows).toHaveLength(SNAPSHOT_KEYS.length);
    expect(rows[0]).toMatchObject({ fixture_id: fixture.id, model_version: prediction.modelVersion, created_at: NOW, outcome: null });
    const sum1x2 = rows.filter((r) => r.market === '1X2').reduce((s, r) => s + r.probability, 0);
    expect(sum1x2).toBeCloseTo(1, 9);

    // The database itself refuses to overwrite a historical probability.
    await expect(db.runAsync('UPDATE predictions SET probability = 0.99 WHERE id = ?', [rows[0]!.id])).rejects.toThrow(/immutable/);
    await expect(db.runAsync('UPDATE predictions SET odds = 3.1 WHERE id = ?', [rows[0]!.id])).rejects.toThrow(/immutable/);
    expect((await listPredictions(db))[0]!.probability).toBe(rows[0]!.probability);
  });

  it('never replaces a snapshot: a second record adds a new one', async () => {
    const db = openTestDb();
    await migrate(db);
    const { fixture, prediction } = setup();
    await recordPrediction(db, fixture, prediction, [], NOW, 'auto');
    await expect(recordPrediction(db, fixture, prediction, [], NOW + 1, 'auto')).rejects.toBeInstanceOf(SnapshotRejected);
    await recordPrediction(db, fixture, prediction, [], NOW + 2, 'manual');
    expect(await listPredictions(db)).toHaveLength(2 * SNAPSHOT_KEYS.length);
  });

  it('refuses snapshots after kickoff and for demo data', async () => {
    const db = openTestDb();
    await migrate(db);
    const { fixture, prediction } = setup();
    await expect(recordPrediction(db, { ...fixture, kickoffUtc: NOW - 1 }, prediction, [], NOW, 'manual')).rejects.toMatchObject({ reason: 'started' });
    await expect(recordPrediction(db, { ...fixture, isDemo: true }, prediction, [], NOW, 'manual')).rejects.toMatchObject({ reason: 'demo' });
  });

  it('stores the odds available at prediction time with source and timestamp', async () => {
    const db = openTestDb();
    await migrate(db);
    const { fixture, prediction } = setup();
    await recordPrediction(db, fixture, prediction, [{ selectionKey: '1X2:H', decimal: 2.4, bookmaker: null, provider: 'manual', quotedAt: NOW - 1000, fetchedAt: NOW - 1000 }], NOW, 'manual');
    const home = (await listPredictions(db)).find((r) => r.selection_key === '1X2:H')!;
    expect(home).toMatchObject({ odds: 2.4, odds_provider: 'manual', odds_quoted_at: NOW - 1000 });
  });

  it('settles snapshots from source results and computes performance', async () => {
    const db = openTestDb();
    await migrate(db);
    const { fixture, prediction } = setup();
    await recordPrediction(db, fixture, prediction, [{ selectionKey: 'OU:2.5:O', decimal: 2.0, bookmaker: 'B', provider: 'the-odds-api', quotedAt: NOW, fetchedAt: NOW }], NOW, 'manual');
    const later = (fixture.kickoffUtc as number) + 4 * 3_600_000;
    const pending = await pendingPredictions(db, later);
    expect(pending).toHaveLength(SNAPSHOT_KEYS.length);
    const settled = await settlePredictionRows(db, pending, { status: 'finished', ft: { home: 2, away: 1 }, ht: { home: 1, away: 0 } }, later, 'openfootball');
    expect(settled).toBe(SNAPSHOT_KEYS.length);
    const rows = await listPredictions(db);
    const outcome = (k: string) => rows.find((r) => r.selection_key === k)!.outcome;
    expect(outcome('1X2:H')).toBe('win');
    expect(outcome('1X2:A')).toBe('loss');
    expect(outcome('OU:2.5:O')).toBe('win');
    expect(outcome('BTTS:Y')).toBe('win');
    expect(await pendingPredictions(db, later)).toHaveLength(0);

    const perf = computePerformance(rows);
    expect(perf.totalSnapshots).toBe(1);
    expect(perf.evaluated).toBe(SNAPSHOT_KEYS.length);
    expect(perf.rpsMatches).toBe(1);
    expect(perf.pnl).toMatchObject({ bets: 1, profit: 1 });
    expect(perf.byMarket.find((g) => g.key === '1X2')!.n).toBe(3);
  });

  it('voids snapshots of cancelled matches', async () => {
    const db = openTestDb();
    await migrate(db);
    const { fixture, prediction } = setup();
    await recordPrediction(db, fixture, prediction, [], NOW, 'manual');
    const pending = await pendingPredictions(db, (fixture.kickoffUtc as number) + 10 * 3_600_000);
    await settlePredictionRows(db, pending, { status: 'cancelled' }, NOW, 'openfootball');
    const rows = await listPredictions(db);
    expect(rows.every((r) => r.outcome === 'void')).toBe(true);
    expect(computePerformance(rows).evaluated).toBe(0);
  });

  it('keeps favourites, slips and manual odds', async () => {
    const db = openTestDb();
    await migrate(db);
    const { fixture } = setup();
    await setFavorite(db, fixture, true, NOW);
    expect((await listFavorites(db)).map((f) => f.id)).toEqual([fixture.id]);
    await setFavorite(db, fixture, false, NOW);
    expect(await listFavorites(db)).toEqual([]);

    const manual = new SqliteManualOdds(db);
    await manual.set(fixture.id, '1X2:H', 2.2, NOW);
    await manual.set(fixture.id, '1X2:H', 2.3, NOW + 1);
    expect(await manual.list(fixture.id)).toEqual([{ selectionKey: '1X2:H', decimal: 2.3, enteredAt: NOW + 1 }]);
    await expect(manual.set(fixture.id, '1X2:D', 0.5, NOW)).rejects.toThrow(RangeError);

    const leg = { fixtureId: fixture.id, competition: 'ENG1', home: 'A', away: 'B', kickoffUtc: NOW, matchDate: fixture.sourceDate, selectionKey: '1X2:H', probability: 0.5, odds: 2.3, oddsProvider: 'manual' as const, oddsBookmaker: null, oddsQuotedAt: NOW };
    const id = await saveSlip(db, { name: 'Test', stake: 10, combinedOdds: 2.3, combinedProbability: 0.5, probabilityMethod: 'independent_matches' }, [leg], NOW);
    const slips = await listSlips(db);
    expect(slips).toHaveLength(1);
    expect(slips[0]!.legs[0]).toMatchObject({ selectionKey: '1X2:H', odds: 2.3 });
    await setLegOutcome(db, slips[0]!.legs[0]!.id, 'win', 'manual', NOW);
    expect((await listSlips(db))[0]!.legs[0]).toMatchObject({ outcome: 'win', outcomeSource: 'manual' });
    await deleteSlip(db, id);
    expect(await listSlips(db)).toEqual([]);
  });

  it('persists cache entries', async () => {
    const db = openTestDb();
    await migrate(db);
    const store = new SqliteCacheStore(db);
    await store.set({ key: 'k', payload: '{"a":1}', fetchedAt: NOW, etag: '"e"', provider: 'openfootball', absent: false });
    expect(await store.get('k')).toEqual({ key: 'k', payload: '{"a":1}', fetchedAt: NOW, etag: '"e"', provider: 'openfootball', absent: false });
    expect(await store.stats()).toEqual({ entries: 1, bytes: 7 });
    await store.clear();
    expect(await store.get('k')).toBeNull();
  });
});
