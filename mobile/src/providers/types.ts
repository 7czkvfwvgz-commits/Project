import type { Fixture, Freshness, LeagueDataset, ProviderId } from '@/domain/types';
import type { OddsQuote } from '@/engine/odds';
import type { StandingRow } from '@/engine/teamStats';
import type { DateKey } from '@/time/tz';
import type { ProviderErrorInfo } from './errors';

export type ProviderRole = 'fixtures' | 'results' | 'statistics' | 'odds' | 'standings';

export type FieldKey =
  | 'fixtures'
  | 'kickoff_time'
  | 'live_status'
  | 'ft_score'
  | 'ht_score'
  | 'standings'
  | 'odds_1x2'
  | 'odds_totals'
  | 'xg'
  | 'shots'
  | 'corners'
  | 'cards'
  | 'lineups'
  | 'injuries'
  | 'player_stats';

export const ALL_FIELDS: FieldKey[] = [
  'fixtures',
  'kickoff_time',
  'live_status',
  'ft_score',
  'ht_score',
  'standings',
  'odds_1x2',
  'odds_totals',
  'xg',
  'shots',
  'corners',
  'cards',
  'lineups',
  'injuries',
  'player_stats',
];

export type FieldAvailability = 'supported' | 'partial' | 'unsupported';

export interface ProviderCapabilities {
  id: ProviderId;
  roles: ProviderRole[];
  fields: Record<FieldKey, FieldAvailability>;
  /** What kind of data the provider serves when it works. */
  dataKind: Freshness;
  requiresCredentials: boolean;
  configured: boolean;
  competitions: string[];
  homepage: string;
  terms: string;
  attribution: string;
}

export function fieldMap(supported: Partial<Record<FieldKey, FieldAvailability>>): Record<FieldKey, FieldAvailability> {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f, supported[f] ?? 'unsupported'])) as Record<FieldKey, FieldAvailability>;
}

export interface ResultMeta {
  provider: ProviderId;
  fetchedAt: number;
  /** live / cached / historical / demo, as served for this request. */
  freshness: Freshness;
  /** Served from cache because the refresh failed. */
  stale: boolean;
  error?: ProviderErrorInfo;
}

export interface FixtureQuery {
  from: DateKey;
  to: DateKey;
  zone: string;
  competitions: string[];
  force?: boolean;
}

export interface ProviderFixtures {
  fixtures: Fixture[];
  /** Competitions this provider had data for in the requested period. */
  covered: string[];
  meta: ResultMeta;
}

export interface FixtureProvider {
  readonly id: ProviderId;
  capabilities(): ProviderCapabilities;
  getFixtures(query: FixtureQuery, signal?: AbortSignal): Promise<ProviderFixtures>;
}

export interface ResultsProvider {
  readonly id: ProviderId;
  /** Results of the given season and the one before it, for statistics and model fitting. */
  getLeagueDataset(competition: string, season: string, options?: { force?: boolean; signal?: AbortSignal }): Promise<{ dataset: LeagueDataset; meta: ResultMeta } | null>;
}

export interface StandingsProvider {
  readonly id: ProviderId;
  getStandings(competition: string, season: string, asOf: DateKey): Promise<{ rows: StandingRow[]; official: boolean; meta: ResultMeta } | null>;
}

export type AdvancedField = 'xg' | 'shots' | 'corners' | 'cards' | 'lineups' | 'injuries';

export interface AdvancedStats {
  /** Fields with no data from any configured provider. */
  unavailable: AdvancedField[];
  checkedProviders: ProviderId[];
}

export interface StatisticsProvider {
  readonly id: ProviderId;
  supportsAdvanced(field: AdvancedField): boolean;
}

export interface OddsProvider {
  readonly id: ProviderId;
  capabilities(): ProviderCapabilities;
  getOdds(fixture: Fixture, signal?: AbortSignal): Promise<{ quotes: OddsQuote[]; meta: ResultMeta }>;
}
