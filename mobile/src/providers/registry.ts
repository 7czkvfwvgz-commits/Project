import { getCompetition } from '@/config/competitions';
import type { ProviderId } from '@/domain/types';
import type { CacheStore } from './cache';
import { DemoProvider } from './demo/provider';
import { FootballDataProvider } from './footballData/provider';
import type { FetchLike } from './http';
import { ManualOddsProvider, type ManualOddsSource } from './odds/manual';
import { TheOddsApiProvider } from './odds/theOddsApi';
import { OpenfootballProvider } from './openfootball/provider';
import type { FixtureProvider, OddsProvider, ProviderCapabilities, ResultsProvider, StandingsProvider } from './types';

export interface ProviderConfig {
  cache: CacheStore;
  manualOdds: ManualOddsSource;
  proxyUrl: string | null;
  clientToken?: string | null;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export interface Providers {
  openfootball: OpenfootballProvider;
  footballData: FootballDataProvider;
  theOddsApi: TheOddsApiProvider;
  manual: ManualOddsProvider;
  demo: DemoProvider;
}

export function createProviders(config: ProviderConfig): Providers {
  const shared = { proxyUrl: config.proxyUrl, clientToken: config.clientToken, fetchImpl: config.fetchImpl, now: config.now };
  return {
    openfootball: new OpenfootballProvider(config.cache, { fetchImpl: config.fetchImpl, now: config.now }),
    footballData: new FootballDataProvider(config.cache, shared),
    theOddsApi: new TheOddsApiProvider(config.cache, shared),
    manual: new ManualOddsProvider(config.manualOdds),
    demo: new DemoProvider(config.now),
  };
}

/** Demo mode is exclusive so fictional and real fixtures are never mixed in one list. */
export function fixtureProviders(p: Providers, demoMode: boolean): FixtureProvider[] {
  return demoMode ? [p.demo] : [p.openfootball, p.footballData];
}

export function resultsProviderFor(p: Providers, competition: string): ResultsProvider | null {
  if (competition === 'DEMO') return p.demo;
  return getCompetition(competition)?.openfootball ? p.openfootball : null;
}

export function standingsProvidersFor(p: Providers, competition: string): StandingsProvider[] {
  const c = getCompetition(competition);
  const out: StandingsProvider[] = [];
  if (c?.footballData && p.footballData.capabilities().configured) out.push(p.footballData);
  if (c?.openfootball) out.push(p.openfootball);
  return out;
}

export function oddsProviders(p: Providers, bettingHidden: boolean): OddsProvider[] {
  if (bettingHidden) return [];
  const out: OddsProvider[] = [p.manual];
  if (p.theOddsApi.capabilities().configured) out.push(p.theOddsApi);
  return out;
}

export function allCapabilities(p: Providers): ProviderCapabilities[] {
  return [p.openfootball.capabilities(), p.footballData.capabilities(), p.theOddsApi.capabilities(), p.manual.capabilities(), p.demo.capabilities()];
}

export const ADVANCED_PROVIDERS_CHECKED: ProviderId[] = ['openfootball', 'football-data'];
