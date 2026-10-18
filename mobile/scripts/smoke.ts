/**
 * End-to-end check against the live openfootball data, using the app's own
 * providers, aggregation, model and ranking (no mocks):
 *
 *   npm run smoke                 # today in Europe/Sofia
 *   npm run smoke -- 2026-10-24   # a specific date
 */
import { DEFAULT_ENABLED_COMPETITIONS, getCompetition } from '@/config/competitions';
import { migrate } from '@/db/schema';
import { SqliteCacheStore, SqliteManualOdds } from '@/db/repos';
import { findEstimate } from '@/engine/markets';
import { DEFAULT_FILTERS, rankSelections } from '@/engine/ranking';
import { translateMsg } from '@/i18n';
import { aggregateFixtures } from '@/providers/aggregate';
import { createProviders, fixtureProviders } from '@/providers/registry';
import { buildShortlist } from '@/services/analysis';
import { isDateKey, todayKey } from '@/time/tz';
import { openTestDb } from '../test-utils/nodeSqlite';

async function main() {
  const zone = 'Europe/Sofia';
  const arg = process.argv[2];
  const date = arg && isDateKey(arg) ? arg : todayKey(zone);
  const db = openTestDb();
  await migrate(db);
  const cache = new SqliteCacheStore(db);
  const manualOdds = new SqliteManualOdds(db);
  const providers = createProviders({ cache, manualOdds, proxyUrl: null });
  const services = { db, cache, manualOdds, providers };

  const started = Date.now();
  const agg = await aggregateFixtures(fixtureProviders(providers, false), { from: date, to: date, zone, competitions: DEFAULT_ENABLED_COMPETITIONS });
  console.log(`date ${date} (${zone}) state=${agg.state} fixtures=${agg.fixtures.length} in ${Date.now() - started} ms`);
  for (const r of agg.reports) console.log(`  ${r.provider}: ${r.status} count=${r.count} covered=[${r.covered.join(',')}]${r.error ? ` error=${r.error.kind}` : ''}`);

  const t0 = Date.now();
  const shortlist = await buildShortlist(services, agg.fixtures, { hideBetting: false, now: Date.now() });
  console.log(`predictions=${shortlist.inputs.length} unsupported=${shortlist.unsupported.length} in ${Date.now() - t0} ms`);
  for (const d of shortlist.datasets) {
    console.log(`  ${d.competition}: results ${d.dataset.matches.length}, latest ${d.dataset.latestResultDate}, pending ${d.dataset.pendingPastFixtures.length}`);
  }
  for (const i of shortlist.inputs.slice(0, 12)) {
    const p = i.prediction;
    const pr = (k: string) => ((findEstimate(p.book, k)?.probability ?? 0) * 100).toFixed(0).padStart(3);
    const ko = i.fixture.kickoffUtc ? new Date(i.fixture.kickoffUtc).toISOString().slice(11, 16) + 'Z' : 'date-only';
    console.log(
      `  ${getCompetition(i.fixture.competition)?.code} ${ko} ${i.fixture.home.short} – ${i.fixture.away.short}: λ ${p.lambdaHome.toFixed(2)}-${p.lambdaAway.toFixed(2)} | 1X2 ${pr('1X2:H')}/${pr('1X2:D')}/${pr('1X2:A')} | O2.5 ${pr('OU:2.5:O')} | BTTS ${pr('BTTS:Y')} | conf ${p.confidence.level}(${p.confidence.score}) quality ${p.quality.grade} | issues ${p.issues.length}`,
    );
  }
  const top = rankSelections(shortlist.inputs, 'top_probability', DEFAULT_FILTERS, 'probability', Date.now()).slice(0, 3);
  console.log('top-probability shortlist:');
  for (const item of top) {
    console.log(`  ${item.fixture.home.short} – ${item.fixture.away.short} ${item.estimate.key} ${(item.estimate.probability * 100).toFixed(1)}%`);
    console.log(`    why: ${item.reasons.map((r) => translateMsg('bg', r)).join(' ')}`);
    console.log(`    counter: ${translateMsg('bg', item.counter)}`);
  }
  const invalid = shortlist.inputs.filter((i) => i.prediction.issues.length > 0);
  if (invalid.length) throw new Error(`${invalid.length} predictions failed consistency checks`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
