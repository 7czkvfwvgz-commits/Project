import { getCompetition } from '@/config/competitions';
import { TEAM_MATCH_THRESHOLD, teamSimilarity } from '@/domain/teams';
import type { Fixture, ProviderId } from '@/domain/types';
import { diffDays } from '@/time/tz';
import { isProviderError, toErrorInfo, type ProviderErrorInfo } from './errors';
import type { FixtureProvider, FixtureQuery, ResultMeta } from './types';

export type ProviderStatus = 'ok' | 'empty' | 'not_covered' | 'error' | 'not_configured';

export interface ProviderReport {
  provider: ProviderId;
  status: ProviderStatus;
  count: number;
  covered: string[];
  meta?: ResultMeta;
  error?: ProviderErrorInfo;
}

/**
 * What the fixture list should say. An empty response is never treated as
 * proof that there are no matches: each failure mode has its own state.
 */
export type ListState =
  | 'ok'
  | 'partial'
  | 'stale'
  | 'no_matches'
  | 'no_coverage'
  | 'api_failure'
  | 'rate_limited'
  | 'missing_credentials';

export interface AggregatedFixtures {
  fixtures: Fixture[];
  reports: ProviderReport[];
  state: ListState;
  /** Oldest fetch time among providers that returned data. */
  fetchedAt: number | null;
  retryAfterSec?: number;
}

function sameMatch(a: Fixture, b: Fixture): boolean {
  if (a.competition !== b.competition) return false;
  if (Math.abs(diffDays(a.sourceDate, b.sourceDate)) > 1) return false;
  return teamSimilarity(a.home.name, b.home.name) >= TEAM_MATCH_THRESHOLD && teamSimilarity(a.away.name, b.away.name) >= TEAM_MATCH_THRESHOLD;
}

/**
 * Merge a live-API fixture into the matching openfootball fixture: identity,
 * team names and history linkage stay with openfootball; status, exact kickoff
 * and scores come from the live API.
 */
function mergeInto(base: Fixture, live: Fixture): Fixture {
  return {
    ...base,
    links: { ...base.links, ...live.links },
    statusProvider: live.provider,
    status: live.status,
    kickoffUtc: live.kickoffUtc ?? base.kickoffUtc,
    kickoffTimeSource: live.kickoffUtc !== null ? live.kickoffTimeSource : base.kickoffTimeSource,
    ft: live.ft ?? base.ft,
    ht: live.ht ?? base.ht,
    minute: live.minute,
    sourceUpdatedAt: live.sourceUpdatedAt,
  };
}

export function mergeFixtures(primary: Fixture[], live: Fixture[]): Fixture[] {
  const out = [...primary];
  for (const f of live) {
    const idx = out.findIndex((p) => p.provider !== f.provider && sameMatch(p, f));
    if (idx >= 0) out[idx] = mergeInto(out[idx] as Fixture, f);
    else out.push(f);
  }
  return out;
}

const LIVE_PROVIDERS: ProviderId[] = ['football-data'];

export function sortFixtures(fixtures: Fixture[]): Fixture[] {
  return [...fixtures].sort((a, b) => {
    const ka = a.kickoffUtc ?? Number.MAX_SAFE_INTEGER;
    const kb = b.kickoffUtc ?? Number.MAX_SAFE_INTEGER;
    if (a.sourceDate !== b.sourceDate && (a.kickoffUtc === null || b.kickoffUtc === null)) return a.sourceDate.localeCompare(b.sourceDate);
    return ka - kb || (getCompetition(a.competition)?.name.en ?? '').localeCompare(getCompetition(b.competition)?.name.en ?? '') || a.home.name.localeCompare(b.home.name);
  });
}

export async function aggregateFixtures(providers: FixtureProvider[], query: FixtureQuery, signal?: AbortSignal): Promise<AggregatedFixtures> {
  const results = await Promise.allSettled(
    providers.map(async (p) => {
      if (!p.capabilities().configured) return { p, notConfigured: true as const };
      return { p, res: await p.getFixtures(query, signal) };
    }),
  );

  const reports: ProviderReport[] = [];
  const primary: Fixture[] = [];
  const live: Fixture[] = [];
  results.forEach((r, i) => {
    const provider = (providers[i] as FixtureProvider).id;
    if (r.status === 'rejected') {
      const error = toErrorInfo(r.reason);
      reports.push({ provider, status: isProviderError(r.reason) && r.reason.kind === 'missing_credentials' ? 'not_configured' : 'error', count: 0, covered: [], error });
      return;
    }
    if ('notConfigured' in r.value) {
      reports.push({ provider, status: 'not_configured', count: 0, covered: [], error: { kind: 'missing_credentials', message: 'not configured' } });
      return;
    }
    const { fixtures, covered, meta } = r.value.res;
    (LIVE_PROVIDERS.includes(provider) ? live : primary).push(...fixtures);
    reports.push({
      provider,
      status: fixtures.length > 0 ? 'ok' : covered.length > 0 ? 'empty' : 'not_covered',
      count: fixtures.length,
      covered,
      meta,
      error: meta.error,
    });
  });

  const fixtures = sortFixtures(mergeFixtures(primary, live));
  const withData = reports.filter((r) => r.status === 'ok' || r.status === 'empty');
  const errors = reports.filter((r) => r.status === 'error');
  const stale = withData.some((r) => r.meta?.stale);
  const fetchedAt = withData.length ? Math.min(...withData.map((r) => r.meta?.fetchedAt ?? Date.now())) : null;

  let state: ListState;
  let retryAfterSec: number | undefined;
  if (fixtures.length > 0) {
    state = stale ? 'stale' : errors.length > 0 || withData.some((r) => r.error) ? 'partial' : 'ok';
  } else if (errors.length > 0) {
    const rate = errors.find((r) => r.error?.kind === 'rate_limited');
    retryAfterSec = rate?.error?.retryAfterSec;
    state = rate ? 'rate_limited' : 'api_failure';
  } else if (withData.length > 0) {
    state = stale ? 'stale' : 'no_matches';
  } else if (reports.length > 0 && reports.every((r) => r.status === 'not_configured')) {
    state = 'missing_credentials';
  } else {
    state = 'no_coverage';
  }
  return { fixtures, reports, state, fetchedAt, retryAfterSec };
}
