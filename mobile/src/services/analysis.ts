import { getCompetition, isModelSupported, type Competition } from '@/config/competitions';
import { listFavorites, pendingPredictions, settlePredictionRows, listSlips, setLegOutcome, type PredictionRow } from '@/db/repos';
import { TEAM_MATCH_THRESHOLD, teamSimilarity } from '@/domain/teams';
import type { Fixture, LeagueDataset, TeamRef } from '@/domain/types';
import { explainMatch, type Explanation } from '@/engine/explain';
import { fitLeagueModel, type LeagueModel } from '@/engine/fit';
import type { OddsQuote } from '@/engine/odds';
import { predictMatch, type MatchPrediction } from '@/engine/predict';
import type { RankingInput } from '@/engine/ranking';
import { parseSelectionKey, settle } from '@/engine/settlement';
import { computeStandings, headToHead, summarizeTeam, type FormEntry, type StandingRow, type TeamSummary } from '@/engine/teamStats';
import { toErrorInfo, type ProviderErrorInfo } from '@/providers/errors';
import { parseFixtureId } from '@/providers/ids';
import { ADVANCED_PROVIDERS_CHECKED, oddsProviders, resultsProviderFor, standingsProvidersFor } from '@/providers/registry';
import type { AdvancedField, ResultMeta } from '@/providers/types';
import { addDays } from '@/time/tz';
import type { AppServices } from './app';

const MODEL_CACHE_LIMIT = 40;
const modelCache = new Map<string, LeagueModel>();

/** Fitting is deterministic for (dataset version, date), so fits are memoised. */
export function modelFor(dataset: LeagueDataset, asOf: string, season: string): LeagueModel {
  const key = `${dataset.competition}|${season}|${asOf}|${dataset.fetchedAt}|${dataset.matches.length}`;
  const hit = modelCache.get(key);
  if (hit) return hit;
  const model = fitLeagueModel(dataset, asOf, season);
  if (modelCache.size >= MODEL_CACHE_LIMIT) modelCache.delete(modelCache.keys().next().value as string);
  modelCache.set(key, model);
  return model;
}

/** Map a team from any provider onto the dataset's team identity. */
export function resolveTeam(dataset: LeagueDataset, team: TeamRef): TeamRef {
  if (dataset.teamNames[team.key]) return team;
  let best: { key: string; score: number } | null = null;
  for (const [key, name] of Object.entries(dataset.teamNames)) {
    const score = teamSimilarity(team.name, name);
    if (score >= TEAM_MATCH_THRESHOLD && (!best || score > best.score)) best = { key, score };
  }
  return best ? { ...team, key: best.key } : team;
}

export function fixtureForDataset(fixture: Fixture, dataset: LeagueDataset): Fixture {
  return { ...fixture, home: resolveTeam(dataset, fixture.home), away: resolveTeam(dataset, fixture.away) };
}

export async function loadDataset(s: AppServices, competition: string, season: string, force = false) {
  const provider = resultsProviderFor(s.providers, competition);
  if (!provider) return null;
  return provider.getLeagueDataset(competition, season, { force });
}

/** Find a fixture by id: the caller's cached lists first, then saved favourites, then the source. */
export async function findFixture(s: AppServices, id: string, cached: Fixture[]): Promise<Fixture | null> {
  const fromLists = cached.find((f) => f.id === id || Object.values(f.links).includes(id));
  if (fromLists) return fromLists;
  const parsed = parseFixtureId(id);
  if (parsed?.provider === 'openfootball') {
    const comp = getCompetition(parsed.competition);
    if (comp) {
      const loaded = await s.providers.openfootball.loadSeason(comp, parsed.season);
      const hit = loaded.parsed?.fixtures.find((f) => f.id === id);
      if (hit) return hit;
    }
  }
  if (parsed?.provider === 'demo') {
    const res = await s.providers.demo.getFixtures({ from: addDays(parsed.date, -1), to: addDays(parsed.date, 1), zone: 'Europe/Sofia', competitions: ['DEMO'] });
    const hit = res.fixtures.find((f) => f.id === id);
    if (hit) return hit;
  }
  const favorite = (await listFavorites(s.db)).find((f) => f.id === id);
  return favorite ?? null;
}

export async function quotesFor(s: AppServices, fixture: Fixture, hideBetting: boolean): Promise<{ quotes: OddsQuote[]; metas: ResultMeta[]; errors: ProviderErrorInfo[] }> {
  const quotes: OddsQuote[] = [];
  const metas: ResultMeta[] = [];
  const errors: ProviderErrorInfo[] = [];
  for (const p of oddsProviders(s.providers, hideBetting)) {
    try {
      const r = await p.getOdds(fixture);
      quotes.push(...r.quotes);
      metas.push(r.meta);
    } catch (e) {
      errors.push(toErrorInfo(e));
    }
  }
  return { quotes, metas, errors };
}

export type UnsupportedReason = 'no_model' | 'no_dataset' | 'inconsistent' | 'error';

export interface MatchAnalysis {
  fixture: Fixture;
  competition: Competition | undefined;
  dataset: LeagueDataset | null;
  datasetMeta: ResultMeta | null;
  prediction: MatchPrediction | null;
  unsupported: UnsupportedReason | null;
  home: TeamSummary | null;
  away: TeamSummary | null;
  standings: { rows: StandingRow[]; official: boolean; meta: ResultMeta } | null;
  h2h: FormEntry[];
  explanation: Explanation | null;
  quotes: OddsQuote[];
  oddsMetas: ResultMeta[];
  oddsErrors: ProviderErrorInfo[];
  advanced: { unavailable: AdvancedField[]; checked: string[] };
  error?: ProviderErrorInfo;
}

const ADVANCED_FIELDS: AdvancedField[] = ['xg', 'shots', 'corners', 'cards', 'lineups', 'injuries'];

export async function analyzeFixture(s: AppServices, fixture: Fixture, opts: { hideBetting: boolean; now: number }): Promise<MatchAnalysis> {
  const competition = getCompetition(fixture.competition);
  const base: MatchAnalysis = {
    fixture,
    competition,
    dataset: null,
    datasetMeta: null,
    prediction: null,
    unsupported: null,
    home: null,
    away: null,
    standings: null,
    h2h: [],
    explanation: null,
    quotes: [],
    oddsMetas: [],
    oddsErrors: [],
    // No configured free provider publishes these fields; say so rather than estimate them.
    advanced: { unavailable: ADVANCED_FIELDS.filter((f) => !s.providers.openfootball.supportsAdvanced(f)), checked: ADVANCED_PROVIDERS_CHECKED },
  };
  const odds = await quotesFor(s, fixture, opts.hideBetting);
  base.quotes = odds.quotes;
  base.oddsMetas = odds.metas;
  base.oddsErrors = odds.errors;

  if (!isModelSupported(fixture.competition)) return { ...base, unsupported: 'no_model' };
  let loaded: Awaited<ReturnType<typeof loadDataset>>;
  try {
    loaded = await loadDataset(s, fixture.competition, fixture.season);
  } catch (e) {
    return { ...base, unsupported: 'error', error: toErrorInfo(e) };
  }
  if (!loaded) return { ...base, unsupported: 'no_dataset' };
  const { dataset, meta } = loaded;
  const f = fixtureForDataset(fixture, dataset);
  const model = modelFor(dataset, f.sourceDate, f.season);
  const prediction = predictMatch({ fixture: f, dataset, model, nowMs: opts.now, servedFromStaleCache: meta.stale });
  const home = summarizeTeam(dataset, f.home.key, f.sourceDate, f.season);
  const away = summarizeTeam(dataset, f.away.key, f.sourceDate, f.season);
  const h2h = headToHead(dataset, f.home.key, f.away.key, f.sourceDate);

  let standings: MatchAnalysis['standings'] = null;
  for (const p of standingsProvidersFor(s.providers, fixture.competition)) {
    try {
      const r = await p.getStandings(fixture.competition, fixture.season, f.sourceDate);
      if (r && r.rows.length > 0) {
        standings = r;
        break;
      }
    } catch {
      // Fall through to the next standings source.
    }
  }
  if (!standings) standings = { rows: computeStandings(dataset, f.season, f.sourceDate), official: false, meta };

  const explanation = prediction.issues.length === 0 ? explainMatch({ fixture: f, prediction, home, away, standings: standings.rows, h2h }) : null;
  return {
    ...base,
    fixture: f,
    dataset,
    datasetMeta: meta,
    prediction: prediction.issues.length === 0 ? prediction : null,
    unsupported: prediction.issues.length === 0 ? null : 'inconsistent',
    home,
    away,
    standings,
    h2h,
    explanation,
  };
}

export interface ShortlistData {
  inputs: RankingInput[];
  datasets: { competition: string; dataset: LeagueDataset; meta: ResultMeta }[];
  unsupported: Fixture[];
  errors: { competition: string; error: ProviderErrorInfo }[];
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Predictions for every model-supported fixture, ready for ranking. */
export async function buildShortlist(s: AppServices, fixtures: Fixture[], opts: { hideBetting: boolean; now: number }): Promise<ShortlistData> {
  const out: ShortlistData = { inputs: [], datasets: [], unsupported: [], errors: [] };
  const groups = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    if (!isModelSupported(f.competition)) {
      out.unsupported.push(f);
      continue;
    }
    const k = `${f.competition}|${f.season}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  for (const [k, group] of groups) {
    const [competition, season] = k.split('|') as [string, string];
    await yieldToUi();
    let loaded: Awaited<ReturnType<typeof loadDataset>>;
    try {
      loaded = await loadDataset(s, competition, season);
    } catch (e) {
      out.errors.push({ competition, error: toErrorInfo(e) });
      continue;
    }
    if (!loaded) {
      out.unsupported.push(...group);
      continue;
    }
    out.datasets.push({ competition, dataset: loaded.dataset, meta: loaded.meta });
    for (const raw of group) {
      const fixture = fixtureForDataset(raw, loaded.dataset);
      const model = modelFor(loaded.dataset, fixture.sourceDate, fixture.season);
      const prediction = predictMatch({ fixture, dataset: loaded.dataset, model, nowMs: opts.now, servedFromStaleCache: loaded.meta.stale });
      const { quotes } = await quotesFor(s, raw, opts.hideBetting);
      out.inputs.push({
        fixture,
        prediction,
        quotes,
        home: summarizeTeam(loaded.dataset, fixture.home.key, fixture.sourceDate, fixture.season),
        away: summarizeTeam(loaded.dataset, fixture.away.key, fixture.sourceDate, fixture.season),
      });
    }
  }
  return out;
}

/**
 * Settle recorded predictions and slip legs whose matches have finished, using
 * results from the sources. Rows the sources cannot settle stay pending.
 */
export async function settlePending(s: AppServices, now: number): Promise<{ predictions: number; legs: number }> {
  const pending = await pendingPredictions(s.db, now);
  const slips = await listSlips(s.db);
  const openLegs = slips.flatMap((sl) => sl.legs).filter((l) => !l.outcome && (l.kickoffUtc === null || l.kickoffUtc < now - 2 * 3_600_000));
  const ids = new Set([...pending.map((p) => p.fixture_id), ...openLegs.map((l) => l.fixtureId)]);
  const byFixture = new Map<string, PredictionRow[]>();
  for (const p of pending) byFixture.set(p.fixture_id, [...(byFixture.get(p.fixture_id) ?? []), p]);

  let predictions = 0;
  let legs = 0;
  for (const id of ids) {
    let fixture: Fixture | null = null;
    try {
      fixture = await findFixture(s, id, []);
    } catch {
      continue;
    }
    if (!fixture || (fixture.status !== 'finished' && fixture.status !== 'cancelled' && fixture.status !== 'abandoned')) continue;
    const result = { status: fixture.status, ft: fixture.ft, ht: fixture.ht };
    predictions += await settlePredictionRows(s.db, byFixture.get(id) ?? [], result, now, fixture.statusProvider ?? fixture.provider);
    for (const leg of openLegs.filter((l) => l.fixtureId === id)) {
      const sel = parseSelectionKey(leg.selectionKey);
      const outcome = fixture.status === 'finished' && sel ? settle(sel, fixture.ft, fixture.ht) : fixture.status !== 'finished' ? 'push' : null;
      if (outcome) {
        await setLegOutcome(s.db, leg.id, outcome, 'source', now);
        legs++;
      }
    }
  }
  return { predictions, legs };
}
