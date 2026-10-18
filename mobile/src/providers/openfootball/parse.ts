import { z } from 'zod';
import type { Competition } from '@/config/competitions';
import { makeTeamRef } from '@/domain/teams';
import type { Fixture, HistoricalMatch, KickoffTimeSource, LeagueDataset, MatchStatus } from '@/domain/types';
import { isDateKey, parseDateKey, todayKey, zonedToUtc, type DateKey } from '@/time/tz';
import { openfootballFixtureId } from '../ids';

/**
 * Schema of github.com/openfootball/football.json season files (CC0-1.0).
 * Each match is validated on its own so a single malformed record cannot hide
 * the rest of the season; invalid records are counted and reported.
 */
const goals = z.number().int().min(0).max(99);
const pair = z.tuple([goals, goals]);
const scoreSchema = z.union([
  // Older records publish the full-time score as a bare [home, away] pair.
  pair,
  z.object({ ft: pair.optional(), ht: pair.optional(), et: pair.optional(), p: pair.optional() }),
]);

export const openfootballMatchSchema = z.object({
  round: z.string().optional(),
  date: z.string().refine(isDateKey, 'invalid date'),
  time: z.string().optional(),
  team1: z.string().trim().min(1),
  team2: z.string().trim().min(1),
  score: scoreSchema.nullish(),
  status: z.string().optional(),
});

export const openfootballSeasonSchema = z.object({
  name: z.string(),
  matches: z.array(z.unknown()),
});

export type OpenfootballSeasonJson = z.infer<typeof openfootballSeasonSchema>;

export interface ParsedSeason {
  competition: string;
  season: string;
  name: string;
  fixtures: Fixture[];
  history: HistoricalMatch[];
  teams: string[];
  teamNames: Record<string, string>;
  skipped: number;
  firstDate: DateKey | null;
  lastDate: DateKey | null;
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?:\s*UTC\s*([+-])(\d{1,2})(?::?(\d{2}))?)?$/;

export function parseKickoff(
  date: DateKey,
  time: string | undefined,
  zone: string | undefined,
): { kickoffUtc: number | null; source: KickoffTimeSource } {
  const m = time ? TIME_RE.exec(time.trim()) : null;
  if (!m) return { kickoffUtc: null, source: 'date_only' };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return { kickoffUtc: null, source: 'date_only' };
  const { year, month, day } = parseDateKey(date);
  if (m[3]) {
    const sign = m[3] === '-' ? -1 : 1;
    const offsetMin = sign * (Number(m[4]) * 60 + Number(m[5] ?? 0));
    return { kickoffUtc: Date.UTC(year, month - 1, day, hour, minute) - offsetMin * 60_000, source: 'explicit_offset' };
  }
  if (!zone) return { kickoffUtc: null, source: 'date_only' };
  return { kickoffUtc: zonedToUtc({ year, month, day, hour, minute }, zone), source: 'league_local' };
}

const STATUS_MAP: Record<string, MatchStatus> = {
  postponed: 'postponed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  awarded: 'awarded',
  abandoned: 'abandoned',
  suspended: 'suspended',
};

export function parseOpenfootballSeason(
  json: unknown,
  competition: Competition,
  season: string,
  nowMs: number,
): ParsedSeason {
  const file = openfootballSeasonSchema.parse(json);
  const fixtures: Fixture[] = [];
  const history: HistoricalMatch[] = [];
  const teamNames: Record<string, string> = {};
  let skipped = 0;
  let firstDate: DateKey | null = null;
  let lastDate: DateKey | null = null;
  const leagueToday = todayKey(competition.tz, nowMs);
  const seen = new Set<string>();

  for (const raw of file.matches) {
    const parsed = openfootballMatchSchema.safeParse(raw);
    if (!parsed.success) {
      skipped++;
      continue;
    }
    const m = parsed.data;
    const home = makeTeamRef(m.team1);
    const away = makeTeamRef(m.team2);
    if (home.key === away.key) {
      skipped++;
      continue;
    }
    const id = openfootballFixtureId(season, competition.code, m.date, home.key, away.key);
    if (seen.has(id)) {
      skipped++;
      continue;
    }
    seen.add(id);
    teamNames[home.key] = home.name;
    teamNames[away.key] = away.name;
    if (!firstDate || m.date < firstDate) firstDate = m.date;
    if (!lastDate || m.date > lastDate) lastDate = m.date;

    const score = m.score ?? undefined;
    const ftPair = Array.isArray(score) ? score : score?.ft;
    const htPair = Array.isArray(score) ? undefined : score?.ht;
    const ft = ftPair ? { home: ftPair[0], away: ftPair[1] } : undefined;
    const ht = htPair ? { home: htPair[0], away: htPair[1] } : undefined;
    const { kickoffUtc, source } = parseKickoff(m.date, m.time, competition.openfootballTimeZone);

    const declared = m.status ? STATUS_MAP[m.status.trim().toLowerCase()] : undefined;
    let status: MatchStatus;
    if (declared) status = declared;
    else if (ft) status = 'finished';
    else if (kickoffUtc !== null ? nowMs > kickoffUtc : m.date < leagueToday) status = 'no_result';
    else status = 'scheduled';

    fixtures.push({
      id,
      provider: 'openfootball',
      links: { openfootball: id },
      competition: competition.code,
      season,
      round: m.round,
      kickoffUtc,
      sourceDate: m.date,
      kickoffTimeSource: source,
      home,
      away,
      status,
      ft,
      ht,
      isDemo: false,
    });

    // Administrative (awarded) results are not football outcomes; keep them out of model training.
    if (ft && status === 'finished') {
      history.push({
        competition: competition.code,
        season,
        date: m.date,
        kickoffUtc,
        home: home.key,
        away: away.key,
        homeName: home.name,
        awayName: away.name,
        ft,
        ht,
      });
    }
  }

  return {
    competition: competition.code,
    season,
    name: file.name,
    fixtures,
    history,
    teams: Object.keys(teamNames).sort(),
    teamNames,
    skipped,
    firstDate,
    lastDate,
  };
}

/** Combine parsed seasons (any order) into the dataset the model and statistics use. */
export function buildLeagueDataset(
  competition: string,
  seasons: ParsedSeason[],
  fetchedAt: number,
  nowMs: number,
  options: { provider?: LeagueDataset['provider']; isDemo?: boolean } = {},
): LeagueDataset {
  const ordered = [...seasons].sort((a, b) => a.season.localeCompare(b.season));
  const matches = ordered.flatMap((s) => s.history).sort((a, b) => a.date.localeCompare(b.date));
  const latest = ordered[ordered.length - 1];
  const teamNames: Record<string, string> = {};
  const teamsBySeason: Record<string, string[]> = {};
  for (const s of ordered) {
    Object.assign(teamNames, s.teamNames);
    teamsBySeason[s.season] = s.teams;
  }
  const pendingPastFixtures = ordered
    .flatMap((s) => s.fixtures)
    .filter((f) => f.status === 'no_result' && (f.kickoffUtc === null || f.kickoffUtc < nowMs))
    .map((f) => ({ date: f.sourceDate, home: f.home.key, away: f.away.key }));
  return {
    competition,
    seasons: ordered.map((s) => s.season),
    matches,
    currentTeams: latest?.teams ?? [],
    teamsBySeason,
    teamNames,
    latestResultDate: matches.length ? (matches[matches.length - 1] as HistoricalMatch).date : null,
    pendingPastFixtures,
    fetchedAt,
    provider: options.provider ?? 'openfootball',
    isDemo: options.isDemo ?? false,
  };
}
