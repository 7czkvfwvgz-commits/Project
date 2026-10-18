import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { PROXY_CLIENT_TOKEN, PROXY_URL } from '@/config/env';
import { listFavorites, listPredictions, listSlips, recordPrediction, setFavorite, SnapshotRejected } from '@/db/repos';
import type { Fixture } from '@/domain/types';
import type { OddsQuote } from '@/engine/odds';
import type { MatchPrediction } from '@/engine/predict';
import { aggregateFixtures, type AggregatedFixtures } from '@/providers/aggregate';
import { isRetryable } from '@/providers/errors';
import { fixtureProviders } from '@/providers/registry';
import { analyzeFixture, buildShortlist, findFixture, settlePending } from '@/services/analysis';
import { getServices } from '@/services/app';
import { useSettings } from '@/state/settings';
import type { DateKey } from '@/time/tz';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Bounded retries with exponential backoff, and only for errors a retry can fix.
        retry: (count, error) => count < 2 && isRetryable(error),
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15_000),
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchInterval: false,
        networkMode: 'offlineFirst',
        gcTime: 30 * 60_000,
      },
    },
  });
}

/** Keys whose next fetch must bypass the cache TTL (pull-to-refresh). */
const forceNext = new Set<string>();

export function useFixtureRange(from: DateKey, to: DateKey) {
  const zone = useSettings((s) => s.timezone);
  const demo = useSettings((s) => s.demoMode);
  const enabled = useSettings((s) => s.enabledCompetitions);
  const queryKey = ['fixtures', from, to, zone, demo, enabled.join(',')];
  const query = useQuery<AggregatedFixtures>({
    queryKey,
    queryFn: async ({ signal }) => {
      const s = await getServices();
      const k = JSON.stringify(queryKey);
      const force = forceNext.delete(k);
      return aggregateFixtures(fixtureProviders(s.providers, demo), { from, to, zone, competitions: demo ? ['DEMO'] : enabled, force }, signal);
    },
    staleTime: 5 * 60_000,
  });
  const refresh = useCallback(() => {
    forceNext.add(JSON.stringify(queryKey));
    return query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.refetch, from, to, zone, demo, enabled]);
  return { ...query, refresh };
}

function cachedFixtures(client: ReturnType<typeof useQueryClient>): Fixture[] {
  return client.getQueriesData<AggregatedFixtures>({ queryKey: ['fixtures'] }).flatMap(([, d]) => d?.fixtures ?? []);
}

export function useMatchAnalysis(id: string) {
  const client = useQueryClient();
  const hideBetting = useSettings((s) => s.hideBetting);
  return useQuery({
    queryKey: ['analysis', id, hideBetting],
    queryFn: async () => {
      const s = await getServices();
      const fixture = await findFixture(s, id, cachedFixtures(client));
      if (!fixture) return null;
      return analyzeFixture(s, fixture, { hideBetting, now: Date.now() });
    },
    staleTime: 5 * 60_000,
  });
}

export function useShortlist(date: DateKey) {
  const fixtures = useFixtureRange(date, date);
  const hideBetting = useSettings((s) => s.hideBetting);
  const list = fixtures.data?.fixtures ?? [];
  const shortlist = useQuery({
    queryKey: ['shortlist', date, hideBetting, list.map((f) => `${f.id}:${f.status}`).join(',')],
    queryFn: async () => buildShortlist(await getServices(), list, { hideBetting, now: Date.now() }),
    enabled: fixtures.isSuccess,
    staleTime: 10 * 60_000,
  });
  return { fixtures, shortlist };
}

export function useFavorites() {
  return useQuery({ queryKey: ['favorites'], queryFn: async () => listFavorites((await getServices()).db) });
}

export function useToggleFavorite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ fixture, favorite }: { fixture: Fixture; favorite: boolean }) => setFavorite((await getServices()).db, fixture, favorite, Date.now()),
    onSuccess: () => client.invalidateQueries({ queryKey: ['favorites'] }),
  });
}

export function usePredictions() {
  return useQuery({ queryKey: ['predictions'], queryFn: async () => listPredictions((await getServices()).db) });
}

export function useRecordPrediction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (args: { fixture: Fixture; prediction: MatchPrediction; quotes: OddsQuote[]; source: 'auto' | 'manual' }) => {
      try {
        return await recordPrediction((await getServices()).db, args.fixture, args.prediction, args.quotes, Date.now(), args.source);
      } catch (e) {
        if (e instanceof SnapshotRejected && args.source === 'auto') return 0;
        throw e;
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['predictions'] }),
  });
}

export function useSlips() {
  return useQuery({ queryKey: ['slips'], queryFn: async () => listSlips((await getServices()).db) });
}

export function useSettle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => settlePending(await getServices(), Date.now()),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['predictions'] });
      client.invalidateQueries({ queryKey: ['slips'] });
    },
  });
}

export function useCacheStats() {
  return useQuery({ queryKey: ['cacheStats'], queryFn: async () => (await getServices()).cache.stats() });
}

export function useSetManualOdds() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ fixtureId, selectionKey, decimal }: { fixtureId: string; selectionKey: string; decimal: number | null }) => {
      const s = await getServices();
      if (decimal === null) await s.manualOdds.remove(fixtureId, selectionKey);
      else await s.manualOdds.set(fixtureId, selectionKey, decimal, Date.now());
    },
    onSuccess: (_d, v) => {
      client.invalidateQueries({ queryKey: ['analysis', v.fixtureId] });
      client.invalidateQueries({ queryKey: ['shortlist'] });
    },
  });
}

export interface ProxyHealth {
  ok: boolean;
  providers?: { footballData: { configured: boolean }; odds: { configured: boolean } };
}

export function useProxyHealth() {
  return useQuery<ProxyHealth>({
    queryKey: ['proxyHealth'],
    enabled: !!PROXY_URL,
    retry: 0,
    queryFn: async () => {
      const res = await fetch(`${PROXY_URL}/v1/health`, { headers: PROXY_CLIENT_TOKEN ? { 'X-Client-Token': PROXY_CLIENT_TOKEN } : {} });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ProxyHealth;
    },
  });
}
