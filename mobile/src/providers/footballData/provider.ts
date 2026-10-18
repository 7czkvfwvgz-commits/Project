import { z } from 'zod';
import { COMPETITIONS, competitionByFootballData, getCompetition, type Competition } from '@/config/competitions';
import { makeTeamRef } from '@/domain/teams';
import type { Fixture, MatchStatus, Score } from '@/domain/types';
import { emptyRecord, type StandingRow } from '@/engine/teamStats';
import { addDays, localDateKey, todayKey } from '@/time/tz';
import { cachedFetchJson, type CacheStore } from '../cache';
import { ProviderError } from '../errors';
import type { FetchLike } from '../http';
import { footballDataFixtureId } from '../ids';
import { fieldMap, type FixtureProvider, type FixtureQuery, type ProviderCapabilities, type ProviderFixtures, type StandingsProvider } from '../types';

/**
 * football-data.org API v4 (free tier: 12 competitions, 10 requests/minute).
 * The API key must stay secret, so the app only talks to our proxy
 * (server/), which adds the X-Auth-Token header and enforces rate limits.
 */
const pair = z.object({ home: z.number().int().min(0).nullable(), away: z.number().int().min(0).nullable() });
const team = z.object({ id: z.number().nullable().optional(), name: z.string().nullable().optional(), shortName: z.string().nullable().optional() });

export const fdMatchSchema = z.object({
  id: z.number().int().positive(),
  utcDate: z.string().refine((s) => Number.isFinite(Date.parse(s)), 'invalid utcDate'),
  status: z.string(),
  matchday: z.number().int().nullable().optional(),
  stage: z.string().nullable().optional(),
  minute: z.union([z.number(), z.string()]).nullable().optional(),
  lastUpdated: z.string().nullable().optional(),
  competition: z.object({ code: z.string().nullable().optional(), name: z.string().optional() }),
  season: z.object({ startDate: z.string().optional() }).nullable().optional(),
  homeTeam: team,
  awayTeam: team,
  score: z
    .object({
      duration: z.string().nullable().optional(),
      fullTime: pair.optional(),
      halfTime: pair.optional(),
      regularTime: pair.optional(),
    })
    .optional(),
});

export const fdMatchesResponseSchema = z.object({ matches: z.array(z.unknown()) });

export const fdStandingsSchema = z.object({
  standings: z.array(
    z.object({
      type: z.string(),
      table: z.array(
        z.object({
          position: z.number().int(),
          team: team,
          playedGames: z.number().int(),
          won: z.number().int(),
          draw: z.number().int(),
          lost: z.number().int(),
          points: z.number().int(),
          goalsFor: z.number().int(),
          goalsAgainst: z.number().int(),
        }),
      ),
    }),
  ),
});

const STATUS: Record<string, MatchStatus> = {
  SCHEDULED: 'scheduled',
  TIMED: 'scheduled',
  IN_PLAY: 'live',
  PAUSED: 'live',
  EXTRA_TIME: 'live',
  PENALTY_SHOOTOUT: 'live',
  LIVE: 'live',
  FINISHED: 'finished',
  POSTPONED: 'postponed',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  AWARDED: 'awarded',
};

const toScore = (p?: z.infer<typeof pair>): Score | undefined =>
  p && p.home !== null && p.away !== null ? { home: p.home, away: p.away } : undefined;

function seasonLabel(comp: Competition, startDate: string | undefined, kickoff: number): string {
  const startYear = startDate ? Number(startDate.slice(0, 4)) : new Date(kickoff).getUTCFullYear();
  return comp.seasonFormat === 'calendar' ? String(startYear) : `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Map one validated v4 match to a Fixture; returns null for matches we cannot represent faithfully. */
export function mapFootballDataMatch(raw: unknown, nowMs: number): Fixture | null {
  const parsed = fdMatchSchema.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;
  const comp = m.competition.code ? competitionByFootballData(m.competition.code) : undefined;
  const homeName = m.homeTeam.name?.trim();
  const awayName = m.awayTeam.name?.trim();
  // Knock-out ties with undecided teams cannot be analysed.
  if (!comp || !homeName || !awayName) return null;
  const utc = Date.parse(m.utcDate);
  // SCHEDULED means the kickoff time is not yet confirmed: keep only the date.
  const timeConfirmed = m.status !== 'SCHEDULED';
  let status = STATUS[m.status] ?? (utc > nowMs ? 'scheduled' : 'no_result');
  if (status === 'scheduled' && timeConfirmed && utc < nowMs) status = 'no_result';
  // Markets settle on 90 minutes: prefer the regular-time score when extra time was played.
  const ft = toScore(m.score?.regularTime) ?? toScore(m.score?.fullTime);
  return {
    id: footballDataFixtureId(m.id),
    provider: 'football-data',
    links: { 'football-data': footballDataFixtureId(m.id) },
    competition: comp.code,
    season: seasonLabel(comp, m.season?.startDate, utc),
    round: m.matchday ? String(m.matchday) : (m.stage ?? undefined),
    kickoffUtc: timeConfirmed ? utc : null,
    sourceDate: localDateKey(utc, comp.tz),
    kickoffTimeSource: timeConfirmed ? 'exact_utc' : 'date_only',
    home: makeTeamRef(homeName),
    away: makeTeamRef(awayName),
    status,
    ft: status === 'finished' || status === 'live' || status === 'awarded' ? ft : undefined,
    ht: toScore(m.score?.halfTime),
    minute: typeof m.minute === 'number' ? m.minute : m.minute ? Number.parseInt(m.minute, 10) || null : null,
    sourceUpdatedAt: m.lastUpdated ? Date.parse(m.lastUpdated) || null : null,
    isDemo: false,
  };
}

export interface FootballDataOptions {
  proxyUrl: string | null;
  clientToken?: string | null;
  fetchImpl?: FetchLike;
  now?: () => number;
}

const MINUTE = 60_000;

export class FootballDataProvider implements FixtureProvider, StandingsProvider {
  readonly id = 'football-data' as const;

  constructor(
    private readonly store: CacheStore,
    private readonly options: FootballDataOptions,
  ) {}

  private now() {
    return (this.options.now ?? Date.now)();
  }

  private headers(): Record<string, string> {
    return this.options.clientToken ? { 'X-Client-Token': this.options.clientToken } : {};
  }

  capabilities(): ProviderCapabilities {
    return {
      id: this.id,
      roles: ['fixtures', 'results', 'standings'],
      fields: fieldMap({ fixtures: 'supported', kickoff_time: 'supported', live_status: 'partial', ft_score: 'supported', ht_score: 'supported', standings: 'supported' }),
      dataKind: 'live',
      requiresCredentials: true,
      configured: !!this.options.proxyUrl,
      competitions: COMPETITIONS.filter((c) => c.footballData).map((c) => c.code),
      homepage: 'https://www.football-data.org',
      terms: 'Free tier after registration: 12 competitions, 10 requests/minute, scores may be delayed. Key stays on the proxy server.',
      attribution: 'Football data provided by the Football-Data.org API',
    };
  }

  private requireProxy(): string {
    if (!this.options.proxyUrl) throw new ProviderError(this.id, 'missing_credentials', 'Proxy URL not configured');
    return this.options.proxyUrl;
  }

  async getFixtures(query: FixtureQuery, signal?: AbortSignal): Promise<ProviderFixtures> {
    const proxy = this.requireProxy();
    const wanted = query.competitions.filter((c) => getCompetition(c)?.footballData);
    const now = this.now();
    if (wanted.length === 0) return { fixtures: [], covered: [], meta: { provider: this.id, fetchedAt: now, freshness: 'live', stale: false } };
    const from = addDays(query.from, -1);
    const to = addDays(query.to, 1);
    const today = todayKey('UTC', now);
    const ttl = to < today ? 6 * 60 * MINUTE : from > addDays(today, 1) ? 30 * MINUTE : 2 * MINUTE;
    const result = await cachedFetchJson(this.store, {
      url: `${proxy}/v1/fd/matches?dateFrom=${from}&dateTo=${to}`,
      provider: this.id,
      ttlMs: ttl,
      headers: this.headers(),
      parse: (json) => fdMatchesResponseSchema.parse(json),
      fetchImpl: this.options.fetchImpl,
      now: this.options.now,
      force: query.force,
      signal,
    });
    const fixtures = (result.data?.matches ?? [])
      .map((m) => mapFootballDataMatch(m, now))
      .filter((f): f is Fixture => !!f && wanted.includes(f.competition))
      .filter((f) => {
        const local = f.kickoffUtc !== null ? localDateKey(f.kickoffUtc, query.zone) : f.sourceDate;
        return local >= query.from && local <= query.to;
      });
    return {
      fixtures,
      covered: wanted,
      meta: { provider: this.id, fetchedAt: result.fetchedAt, freshness: result.fromCache || result.stale ? 'cached' : 'live', stale: result.stale, error: result.error },
    };
  }

  async getStandings(competition: string) {
    const comp = getCompetition(competition);
    if (!comp?.footballData || !this.options.proxyUrl) return null;
    const result = await cachedFetchJson(this.store, {
      url: `${this.options.proxyUrl}/v1/fd/competitions/${comp.footballData}/standings`,
      provider: this.id,
      ttlMs: 30 * MINUTE,
      headers: this.headers(),
      parse: (json) => fdStandingsSchema.parse(json),
      fetchImpl: this.options.fetchImpl,
      now: this.options.now,
    });
    const total = result.data?.standings.find((s) => s.type === 'TOTAL');
    if (!total) return null;
    const rows: StandingRow[] = total.table.map((r) => {
      const ref = makeTeamRef(r.team.name ?? '?');
      return {
        position: r.position,
        team: ref.key,
        name: ref.name,
        played: r.playedGames,
        won: r.won,
        drawn: r.draw,
        lost: r.lost,
        gf: r.goalsFor,
        ga: r.goalsAgainst,
        points: r.points,
        goalDifference: r.goalsFor - r.goalsAgainst,
        home: emptyRecord(),
        away: emptyRecord(),
      };
    });
    return {
      rows,
      official: true,
      meta: { provider: this.id, fetchedAt: result.fetchedAt, freshness: result.fromCache ? ('cached' as const) : ('live' as const), stale: result.stale, error: result.error },
    };
  }
}
