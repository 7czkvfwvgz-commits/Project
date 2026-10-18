import { COMPETITIONS, getCompetition, previousSeason, seasonForDate, type Competition } from '@/config/competitions';
import type { Fixture } from '@/domain/types';
import { computeStandings } from '@/engine/teamStats';
import { addDays, localDateKey, todayKey, type DateKey } from '@/time/tz';
import { cachedFetchJson, type CacheStore, type CachedResult } from '../cache';
import { ProviderError, toErrorInfo, type ProviderErrorInfo } from '../errors';
import type { FetchLike } from '../http';
import { mapLimit } from '../limit';
import {
  fieldMap,
  type FixtureProvider,
  type FixtureQuery,
  type ProviderCapabilities,
  type ProviderFixtures,
  type ResultMeta,
  type ResultsProvider,
  type StandingsProvider,
  type StatisticsProvider,
  type AdvancedField,
} from '../types';
import { buildLeagueDataset, openfootballSeasonSchema, parseOpenfootballSeason, type OpenfootballSeasonJson, type ParsedSeason } from './parse';

export const OPENFOOTBALL_BASE_URL = 'https://raw.githubusercontent.com/openfootball/football.json/master';

const HOUR = 3_600_000;
/** The current season's files are regenerated daily (05:00 UTC); revalidate a few times a day. */
const CURRENT_SEASON_TTL = 3 * HOUR;
const PAST_SEASON_TTL = 7 * 24 * HOUR;
const ABSENT_TTL = 12 * HOUR;
/** Statuses depend on the clock (scheduled → no result), so parsed seasons are reused for at most this long. */
const PARSE_REUSE_MS = 5 * 60_000;

interface LoadedSeason {
  parsed: ParsedSeason | null;
  result: CachedResult<OpenfootballSeasonJson>;
}

export interface OpenfootballOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class OpenfootballProvider implements FixtureProvider, ResultsProvider, StandingsProvider, StatisticsProvider {
  readonly id = 'openfootball' as const;
  private readonly parsedCache = new Map<string, { fetchedAt: number; parsedAt: number; parsed: ParsedSeason }>();

  constructor(
    private readonly store: CacheStore,
    private readonly options: OpenfootballOptions = {},
  ) {}

  private now() {
    return (this.options.now ?? Date.now)();
  }

  capabilities(): ProviderCapabilities {
    return {
      id: this.id,
      roles: ['fixtures', 'results', 'statistics', 'standings'],
      fields: fieldMap({ fixtures: 'supported', kickoff_time: 'partial', ft_score: 'supported', ht_score: 'partial', standings: 'partial' }),
      dataKind: 'historical',
      requiresCredentials: false,
      configured: true,
      competitions: COMPETITIONS.filter((c) => c.openfootball).map((c) => c.code),
      homepage: 'https://github.com/openfootball/football.json',
      terms: 'CC0-1.0 (public domain). Regenerated daily from the Football.TXT sources; not a live feed.',
      attribution: 'Fixtures and results: openfootball / football.json (CC0-1.0)',
    };
  }

  seasonUrl(comp: Competition, season: string): string {
    return `${this.options.baseUrl ?? OPENFOOTBALL_BASE_URL}/${season}/${comp.openfootball}.json`;
  }

  async loadSeason(comp: Competition, season: string, force = false, signal?: AbortSignal): Promise<LoadedSeason> {
    const now = this.now();
    const isCurrent = season === seasonForDate(comp, todayKey(comp.tz, now));
    const url = this.seasonUrl(comp, season);
    const result = await cachedFetchJson(this.store, {
      url,
      provider: this.id,
      ttlMs: isCurrent ? CURRENT_SEASON_TTL : PAST_SEASON_TTL,
      absentTtlMs: ABSENT_TTL,
      parse: (json) => openfootballSeasonSchema.parse(json),
      fetchImpl: this.options.fetchImpl,
      now: this.options.now,
      force,
      signal,
    });
    if (!result.data) return { parsed: null, result };
    const memo = this.parsedCache.get(url);
    if (memo && memo.fetchedAt === result.fetchedAt && now - memo.parsedAt < PARSE_REUSE_MS) return { parsed: memo.parsed, result };
    const parsed = parseOpenfootballSeason(result.data, comp, season, now);
    this.parsedCache.set(url, { fetchedAt: result.fetchedAt, parsedAt: now, parsed });
    return { parsed, result };
  }

  async getFixtures(query: FixtureQuery, signal?: AbortSignal): Promise<ProviderFixtures> {
    const comps = query.competitions.map(getCompetition).filter((c): c is Competition => !!c?.openfootball);
    // Pad by a day: a kickoff on the source date can fall on the neighbouring day in the user's zone.
    const padFrom = addDays(query.from, -1);
    const padTo = addDays(query.to, 1);
    const jobs: { comp: Competition; season: string }[] = [];
    for (const comp of comps) {
      for (const season of new Set([seasonForDate(comp, padFrom), seasonForDate(comp, padTo)])) jobs.push({ comp, season });
    }
    const settled = await mapLimit(jobs, 4, async (job) => ({ job, loaded: await this.loadSeason(job.comp, job.season, query.force, signal) }));

    const fixtures: Fixture[] = [];
    const covered = new Set<string>();
    const errors: ProviderErrorInfo[] = [];
    let stale = false;
    let fromCacheOnly = true;
    let oldest = Infinity;
    for (const s of settled) {
      if (s.status === 'rejected') {
        errors.push(toErrorInfo(s.reason));
        continue;
      }
      const { job, loaded } = s.value;
      const r = loaded.result;
      oldest = Math.min(oldest, r.fetchedAt);
      stale ||= r.stale;
      fromCacheOnly &&= r.fromCache;
      if (r.error) errors.push(r.error);
      const parsed = loaded.parsed;
      if (!parsed || !parsed.firstDate || !parsed.lastDate) continue;
      if (parsed.firstDate <= query.to && parsed.lastDate >= query.from) covered.add(job.comp.code);
      for (const f of parsed.fixtures) {
        if (f.sourceDate < padFrom || f.sourceDate > padTo) continue;
        const local = f.kickoffUtc !== null ? localDateKey(f.kickoffUtc, query.zone) : f.sourceDate;
        if (local >= query.from && local <= query.to) fixtures.push(f);
      }
    }

    if (settled.length > 0 && settled.every((s) => s.status === 'rejected')) {
      const first = settled[0] as PromiseRejectedResult;
      throw first.reason instanceof ProviderError ? first.reason : new ProviderError(this.id, 'network', String(first.reason));
    }

    const meta: ResultMeta = {
      provider: this.id,
      fetchedAt: Number.isFinite(oldest) ? oldest : this.now(),
      freshness: stale || fromCacheOnly ? 'cached' : 'historical',
      stale,
      error: errors[0],
    };
    return { fixtures, covered: [...covered], meta };
  }

  async getLeagueDataset(competition: string, season: string, options: { force?: boolean; signal?: AbortSignal } = {}) {
    const comp = getCompetition(competition);
    if (!comp?.openfootball) return null;
    const [cur, prev] = await Promise.all([
      this.loadSeason(comp, season, options.force, options.signal),
      this.loadSeason(comp, previousSeason(season), options.force, options.signal).catch(() => null),
    ]);
    if (!cur.parsed) return null;
    const parts = [cur, prev].filter((x): x is LoadedSeason => !!x?.parsed);
    const fetchedAt = Math.min(...parts.map((p) => p.result.fetchedAt));
    const stale = parts.some((p) => p.result.stale);
    const dataset = buildLeagueDataset(
      competition,
      parts.map((p) => p.parsed as ParsedSeason),
      fetchedAt,
      this.now(),
    );
    const meta: ResultMeta = {
      provider: this.id,
      fetchedAt,
      freshness: stale || parts.every((p) => p.result.fromCache) ? 'cached' : 'historical',
      stale,
      error: parts.find((p) => p.result.error)?.result.error,
    };
    return { dataset, meta };
  }

  async getStandings(competition: string, season: string, asOf: DateKey) {
    const loaded = await this.getLeagueDataset(competition, season);
    if (!loaded) return null;
    return { rows: computeStandings(loaded.dataset, season, asOf), official: false, meta: loaded.meta };
  }

  /** football.json publishes fixtures and scores only: no xG, shots, corners, cards, lineups or injuries. */
  supportsAdvanced(_field: AdvancedField): boolean {
    return false;
  }
}
