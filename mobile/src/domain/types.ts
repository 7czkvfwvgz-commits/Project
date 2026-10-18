import type { DateKey } from '@/time/tz';

export type ProviderId = 'openfootball' | 'football-data' | 'the-odds-api' | 'manual' | 'demo';

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'suspended'
  | 'awarded'
  | 'abandoned'
  /** Kickoff has passed but the source does not (yet) contain a result. */
  | 'no_result';

/** How current a piece of data is, as reported by the provider that served it. */
export type Freshness = 'live' | 'cached' | 'historical' | 'demo' | 'unavailable';

export interface TeamRef {
  /** Name exactly as published by the source. */
  name: string;
  /** Display name with common legal suffixes removed. */
  short: string;
  /** Normalised identity used to join data across seasons and providers. */
  key: string;
}

export interface Score {
  home: number;
  away: number;
}

export type KickoffTimeSource =
  /** Provider publishes an exact UTC timestamp. */
  | 'exact_utc'
  /** Provider publishes a local time with an explicit UTC offset. */
  | 'explicit_offset'
  /** Provider publishes a local time without a zone; we assume the league's home zone. */
  | 'league_local'
  /** Provider publishes only a date. */
  | 'date_only';

export interface Fixture {
  /** Provider-derived identifier (never invented): see providers/ids.ts. */
  id: string;
  provider: ProviderId;
  /** Identifiers of the same match at other providers, when matched. */
  links: Partial<Record<ProviderId, string>>;
  competition: string;
  season: string;
  round?: string;
  /** Kickoff instant in UTC ms, or null when only the date is known. */
  kickoffUtc: number | null;
  /** Match date as published by the source (in the competition's home zone). */
  sourceDate: DateKey;
  kickoffTimeSource: KickoffTimeSource;
  home: TeamRef;
  away: TeamRef;
  status: MatchStatus;
  ft?: Score;
  ht?: Score;
  /** Minute of play when the provider reports live data. */
  minute?: number | null;
  /** When the provider last changed this record, if it says. */
  sourceUpdatedAt?: number | null;
  isDemo: boolean;
}

/** A completed match with a full-time score, used for statistics and model fitting. */
export interface HistoricalMatch {
  competition: string;
  season: string;
  date: DateKey;
  kickoffUtc: number | null;
  home: string;
  away: string;
  homeName: string;
  awayName: string;
  ft: Score;
  ht?: Score;
}

/** All results the app knows for one competition, oldest first. */
export interface LeagueDataset {
  competition: string;
  /** Seasons included, oldest first. */
  seasons: string[];
  matches: HistoricalMatch[];
  /** Teams in the latest included season. */
  currentTeams: string[];
  /** Teams per season. */
  teamsBySeason: Record<string, string[]>;
  teamNames: Record<string, string>;
  /** Date of the latest result present in the source. */
  latestResultDate: DateKey | null;
  /** Fixtures dated in the past that still have no result in the source. */
  pendingPastFixtures: { date: DateKey; home: string; away: string }[];
  fetchedAt: number;
  provider: ProviderId;
  isDemo: boolean;
}
