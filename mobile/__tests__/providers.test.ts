import { aggregateFixtures, mergeFixtures } from '@/providers/aggregate';
import { MemoryCacheStore } from '@/providers/cache';
import { DemoProvider } from '@/providers/demo/provider';
import { ProviderError } from '@/providers/errors';
import { FootballDataProvider, mapFootballDataMatch } from '@/providers/footballData/provider';
import { httpGet } from '@/providers/http';
import { matchOddsEvent, quotesFromEvent, type OddsEvent } from '@/providers/odds/theOddsApi';
import { OPENFOOTBALL_BASE_URL, OpenfootballProvider } from '@/providers/openfootball/provider';
import type { FixtureProvider } from '@/providers/types';
import { fakeFetch } from '../test-utils/fakeFetch';

const NOW = Date.UTC(2026, 9, 18, 10, 0); // 13:00 in Sofia
const EPL_2026 = {
  name: 'English Premier League 2026/27',
  matches: [
    { round: 'Matchday 8', date: '2026-10-17', time: '15:00', team1: 'Fulham FC', team2: 'Hull City AFC', score: { ft: [1, 1], ht: [0, 1] } },
    { round: 'Matchday 8', date: '2026-10-17', time: '23:30', team1: 'Everton FC', team2: 'Chelsea FC' },
    { round: 'Matchday 8', date: '2026-10-18', time: '14:00', team1: 'Leeds United FC', team2: 'Manchester United FC' },
    { round: 'Matchday 8', date: '2026-10-18', time: '22:30', team1: 'Nottingham Forest FC', team2: 'Arsenal FC' },
    { round: 'Matchday 8', date: '2026-10-18', team1: 'Brentford FC', team2: 'Liverpool FC', status: 'postponed' },
    { round: 'Matchday 8', date: '2026-10-18', time: '09:00', team1: 'Bournemouth AFC', team2: 'Sunderland AFC' },
    { round: 'Matchday 8', date: 'not-a-date', team1: 'Broken', team2: 'Record' },
  ],
};
const EPL_2025 = {
  name: 'English Premier League 2025/26',
  matches: [{ round: 'Matchday 1', date: '2025-08-15', time: '20:00', team1: 'Liverpool FC', team2: 'AFC Bournemouth', score: [4, 2] }],
};
const url = (season: string, code: string) => `${OPENFOOTBALL_BASE_URL}/${season}/${code}.json`;

function openfootball(routes: Parameters<typeof fakeFetch>[0], now = () => NOW) {
  const ff = fakeFetch(routes);
  const store = new MemoryCacheStore();
  return { ff, store, provider: new OpenfootballProvider(store, { fetchImpl: ff.fetch, now }) };
}

describe('openfootball provider', () => {
  const query = { from: '2026-10-18', to: '2026-10-18', zone: 'Europe/Sofia', competitions: ['ENG1'] };

  it('returns fixtures on the user’s local date, including matches that cross midnight', async () => {
    const { provider } = openfootball({ [url('2026-27', 'en.1')]: { status: 200, body: EPL_2026 } });
    const res = await provider.getFixtures(query);
    const names = res.fixtures.map((f) => `${f.home.short}-${f.away.short}`).sort();
    // 23:30 London on the 17th is 01:30 on the 18th in Sofia; 22:30 London on the 18th is 00:30 on the 19th.
    expect(names).toEqual(['Bournemouth-Sunderland', 'Brentford-Liverpool', 'Everton-Chelsea', 'Leeds United-Manchester United']);
    expect(res.covered).toEqual(['ENG1']);
  });

  it('derives statuses without inventing results', async () => {
    const { provider } = openfootball({ [url('2026-27', 'en.1')]: { status: 200, body: EPL_2026 } });
    const res = await provider.getFixtures({ ...query, from: '2026-10-17', to: '2026-10-19' });
    const by = (home: string) => res.fixtures.find((f) => f.home.short === home)!;
    expect(by('Fulham').status).toBe('finished');
    expect(by('Fulham').ft).toEqual({ home: 1, away: 1 });
    expect(by('Fulham').ht).toEqual({ home: 0, away: 1 });
    expect(by('Bournemouth').status).toBe('no_result'); // kicked off at 08:00 UTC, no score in the source
    expect(by('Leeds United').status).toBe('scheduled');
    expect(by('Brentford').status).toBe('postponed');
    expect(by('Brentford').kickoffUtc).toBeNull();
    expect(by('Leeds United').kickoffUtc).toBe(Date.UTC(2026, 9, 18, 13, 0));
    expect(by('Leeds United').id).toBe('of|2026-27|ENG1|2026-10-18|leeds-united|manchester-united');
  });

  it('treats a 404 season file as no coverage, not as an empty day', async () => {
    const { provider } = openfootball({});
    const res = await provider.getFixtures({ ...query, competitions: ['ENG1', 'SCO1'] });
    expect(res.fixtures).toEqual([]);
    expect(res.covered).toEqual([]);
  });

  it('shows only the date for leagues whose published times are not verified', async () => {
    const sco = { name: 'Scottish Premiership 2026/27', matches: [{ round: '1', date: '2026-10-18', time: '14:00', team1: 'Celtic FC', team2: 'Rangers FC' }] };
    const { provider } = openfootball({ [url('2026-27', 'sco.1')]: { status: 200, body: sco } });
    const res = await provider.getFixtures({ ...query, competitions: ['SCO1'] });
    expect(res.fixtures[0]!.kickoffUtc).toBeNull();
    expect(res.fixtures[0]!.kickoffTimeSource).toBe('date_only');
  });

  it('caches, revalidates with ETag and falls back to stale cache on failure', async () => {
    let clock = NOW;
    let mode: 'ok' | '304' | 'down' = 'ok';
    const { provider, ff } = openfootball(
      {
        [url('2026-27', 'en.1')]: (headers) =>
          mode === 'down' ? new Error('offline') : mode === '304' && headers['If-None-Match'] === '"v1"' ? { status: 304 } : { status: 200, body: EPL_2026, headers: { ETag: '"v1"' } },
      },
      () => clock,
    );
    const first = await provider.getFixtures(query);
    expect(first.meta.stale).toBe(false);
    await provider.getFixtures(query);
    expect(ff.calls).toHaveLength(1); // served from cache within the TTL

    clock += 4 * 3_600_000;
    mode = '304';
    const revalidated = await provider.getFixtures(query);
    expect(ff.calls).toHaveLength(2);
    expect(ff.calls[1]!.headers['If-None-Match']).toBe('"v1"');
    expect(revalidated.fixtures.length).toBe(first.fixtures.length);

    clock += 4 * 3_600_000;
    mode = 'down';
    const stale = await provider.getFixtures(query);
    expect(stale.meta.stale).toBe(true);
    expect(stale.meta.freshness).toBe('cached');
    expect(stale.fixtures.length).toBe(first.fixtures.length);
  });

  it('builds a two-season dataset for the model, tolerating the list-form score', async () => {
    const { provider } = openfootball({ [url('2026-27', 'en.1')]: { status: 200, body: EPL_2026 }, [url('2025-26', 'en.1')]: { status: 200, body: EPL_2025 } });
    const res = await provider.getLeagueDataset('ENG1', '2026-27');
    expect(res!.dataset.seasons).toEqual(['2025-26', '2026-27']);
    expect(res!.dataset.matches.map((m) => `${m.homeName} ${m.ft.home}-${m.ft.away}`)).toEqual(['Liverpool FC 4-2', 'Fulham FC 1-1']);
    expect(res!.dataset.latestResultDate).toBe('2026-10-17');
    // Both matches whose kickoff has passed without a result in the source are reported as pending.
    expect(res!.dataset.pendingPastFixtures.map((p) => p.home)).toEqual(['everton', 'bournemouth']);
  });
});

describe('HTTP policy', () => {
  it('maps 429 to a rate-limit error with Retry-After and does not retry it', async () => {
    const ff = fakeFetch({ 'x.test': { status: 429, body: { message: 'Too many requests' }, headers: { 'Retry-After': '42' } } });
    await expect(httpGet('https://x.test/a', { provider: 'football-data', fetchImpl: ff.fetch, sleep: async () => undefined })).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterSec: 42,
    });
    expect(ff.calls).toHaveLength(1);
  });

  it('retries network failures with exponential backoff, then gives up', async () => {
    const delays: number[] = [];
    const ff = fakeFetch({ 'x.test': new Error('socket hang up') });
    await expect(
      httpGet('https://x.test/a', { provider: 'openfootball', fetchImpl: ff.fetch, retries: 2, baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) }),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(ff.calls).toHaveLength(3);
    expect(delays).toEqual([100, 200]);
  });

  it('recognises the proxy’s missing-credentials answer', async () => {
    const ff = fakeFetch({ 'proxy.test': { status: 503, body: { error: 'missing_credentials', message: 'FOOTBALL_DATA_API_KEY not set' } } });
    await expect(httpGet('https://proxy.test/v1/fd/matches', { provider: 'football-data', fetchImpl: ff.fetch, retries: 0 })).rejects.toMatchObject({ kind: 'missing_credentials' });
  });
});

const fdMatch = (over: Record<string, unknown> = {}) => ({
  id: 537001,
  utcDate: '2026-10-18T13:00:00Z',
  status: 'TIMED',
  matchday: 8,
  competition: { code: 'PL', name: 'Premier League' },
  season: { startDate: '2026-08-21' },
  homeTeam: { id: 341, name: 'Leeds United FC' },
  awayTeam: { id: 66, name: 'Manchester United FC' },
  score: { fullTime: { home: null, away: null }, halfTime: { home: null, away: null } },
  lastUpdated: '2026-10-18T09:00:00Z',
  ...over,
});

describe('football-data.org mapping', () => {
  it('maps a timed match with an exact UTC kickoff', () => {
    const f = mapFootballDataMatch(fdMatch(), NOW)!;
    expect(f.id).toBe('fd|537001');
    expect(f.competition).toBe('ENG1');
    expect(f.season).toBe('2026-27');
    expect(f.kickoffUtc).toBe(Date.UTC(2026, 9, 18, 13));
    expect(f.status).toBe('scheduled');
  });

  it('keeps only the date when the kickoff time is not confirmed (SCHEDULED)', () => {
    const f = mapFootballDataMatch(fdMatch({ status: 'SCHEDULED' }), NOW)!;
    expect(f.kickoffUtc).toBeNull();
    expect(f.kickoffTimeSource).toBe('date_only');
  });

  it('maps live and finished matches, preferring the 90-minute score', () => {
    expect(mapFootballDataMatch(fdMatch({ status: 'IN_PLAY', minute: 63, score: { fullTime: { home: 1, away: 0 } } }), NOW)).toMatchObject({ status: 'live', minute: 63, ft: { home: 1, away: 0 } });
    const et = mapFootballDataMatch(
      fdMatch({ status: 'FINISHED', score: { duration: 'EXTRA_TIME', fullTime: { home: 2, away: 1 }, regularTime: { home: 1, away: 1 }, halfTime: { home: 0, away: 1 } } }),
      NOW,
    )!;
    expect(et.ft).toEqual({ home: 1, away: 1 });
    expect(et.ht).toEqual({ home: 0, away: 1 });
  });

  it('skips matches it cannot represent faithfully', () => {
    expect(mapFootballDataMatch(fdMatch({ homeTeam: { id: null, name: null } }), NOW)).toBeNull();
    expect(mapFootballDataMatch(fdMatch({ competition: { code: 'XYZ' } }), NOW)).toBeNull();
    expect(mapFootballDataMatch({ id: 'nope' }, NOW)).toBeNull();
  });

  it('reports missing credentials when no proxy is configured', async () => {
    const p = new FootballDataProvider(new MemoryCacheStore(), { proxyUrl: null });
    expect(p.capabilities().configured).toBe(false);
    await expect(p.getFixtures({ from: '2026-10-18', to: '2026-10-18', zone: 'Europe/Sofia', competitions: ['ENG1'] })).rejects.toBeInstanceOf(ProviderError);
  });

  it('fetches through the proxy and filters by local date', async () => {
    const ff = fakeFetch({ 'proxy.test/v1/fd/matches': { status: 200, body: { matches: [fdMatch(), fdMatch({ id: 2, utcDate: '2026-10-19T19:00:00Z' })] } } });
    const p = new FootballDataProvider(new MemoryCacheStore(), { proxyUrl: 'https://proxy.test', fetchImpl: ff.fetch, now: () => NOW });
    const res = await p.getFixtures({ from: '2026-10-18', to: '2026-10-18', zone: 'Europe/Sofia', competitions: ['ENG1'] });
    expect(res.fixtures.map((f) => f.id)).toEqual(['fd|537001']);
    expect(ff.calls[0]!.url).toBe('https://proxy.test/v1/fd/matches?dateFrom=2026-10-17&dateTo=2026-10-19');
  });
});

describe('odds event matching', () => {
  const event: OddsEvent = {
    id: 'e1',
    sport_key: 'soccer_epl',
    commence_time: '2026-10-18T13:00:00Z',
    home_team: 'Leeds United',
    away_team: 'Manchester United',
    bookmakers: [
      {
        key: 'book_a',
        title: 'Book A',
        last_update: '2026-10-18T09:30:00Z',
        markets: [
          { key: 'h2h', outcomes: [{ name: 'Leeds United', price: 2.9 }, { name: 'Manchester United', price: 2.4 }, { name: 'Draw', price: 3.4 }] },
          { key: 'totals', outcomes: [{ name: 'Over', price: 1.85, point: 2.5 }, { name: 'Under', price: 1.95, point: 2.5 }, { name: 'Over', price: 2.1, point: 2.75 }] },
        ],
      },
    ],
  };
  const fixture = mapFootballDataMatch(fdMatch(), NOW)!;

  it('matches by both team names and kickoff', () => {
    expect(matchOddsEvent(fixture, [event])?.id).toBe('e1');
  });

  it('refuses swapped sides or a different kickoff', () => {
    expect(matchOddsEvent(fixture, [{ ...event, home_team: 'Manchester United', away_team: 'Leeds United' }])).toBeNull();
    expect(matchOddsEvent(fixture, [{ ...event, commence_time: '2026-10-19T13:00:00Z' }])).toBeNull();
  });

  it('maps h2h and totals to precise selections and skips quarter lines', () => {
    const quotes = quotesFromEvent(event, NOW);
    expect(quotes.map((q) => `${q.selectionKey}@${q.decimal}`).sort()).toEqual(['1X2:A@2.4', '1X2:D@3.4', '1X2:H@2.9', 'OU:2.5:O@1.85', 'OU:2.5:U@1.95']);
    expect(quotes.every((q) => q.bookmaker === 'Book A' && q.quotedAt === Date.parse('2026-10-18T09:30:00Z'))).toBe(true);
  });
});

describe('aggregation states', () => {
  const okProvider = (id: 'openfootball' | 'football-data', fixtures: ReturnType<typeof mapFootballDataMatch>[], covered = ['ENG1'], stale = false): FixtureProvider => ({
    id,
    capabilities: () => ({ configured: true }) as never,
    getFixtures: async () => ({ fixtures: fixtures.filter((f): f is NonNullable<typeof f> => !!f), covered, meta: { provider: id, fetchedAt: NOW, freshness: 'historical', stale } }),
  });
  const failing = (id: 'openfootball' | 'football-data', kind: ConstructorParameters<typeof ProviderError>[1]): FixtureProvider => ({
    id,
    capabilities: () => ({ configured: true }) as never,
    getFixtures: async () => {
      throw new ProviderError(id, kind, kind, { retryAfterSec: 30 });
    },
  });
  const q = { from: '2026-10-18', to: '2026-10-18', zone: 'Europe/Sofia', competitions: ['ENG1'] };
  const f = mapFootballDataMatch(fdMatch(), NOW);

  it('ok / partial / stale', async () => {
    expect((await aggregateFixtures([okProvider('openfootball', [f])], q)).state).toBe('ok');
    expect((await aggregateFixtures([okProvider('openfootball', [f]), failing('football-data', 'server')], q)).state).toBe('partial');
    expect((await aggregateFixtures([okProvider('openfootball', [f], ['ENG1'], true)], q)).state).toBe('stale');
  });

  it('distinguishes no matches, no coverage, failures, rate limits and missing credentials', async () => {
    expect((await aggregateFixtures([okProvider('openfootball', [])], q)).state).toBe('no_matches');
    expect((await aggregateFixtures([okProvider('openfootball', [], [])], q)).state).toBe('no_coverage');
    expect((await aggregateFixtures([failing('openfootball', 'network')], q)).state).toBe('api_failure');
    const rate = await aggregateFixtures([failing('football-data', 'rate_limited')], q);
    expect(rate.state).toBe('rate_limited');
    expect(rate.retryAfterSec).toBe(30);
    const creds = await aggregateFixtures([new FootballDataProvider(new MemoryCacheStore(), { proxyUrl: null })], q);
    expect(creds.state).toBe('missing_credentials');
  });

  it('merges the same match from two providers, taking live status from the API', () => {
    const of = { ...f!, id: 'of|2026-27|ENG1|2026-10-18|leeds-united|manchester-united', provider: 'openfootball' as const, status: 'scheduled' as const, links: {} };
    const live = { ...f!, status: 'live' as const, ft: { home: 1, away: 0 } };
    const merged = mergeFixtures([of], [live]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: of.id, status: 'live', statusProvider: 'football-data', ft: { home: 1, away: 0 } });
    expect(merged[0]!.links['football-data']).toBe('fd|537001');
  });
});

describe('demo provider', () => {
  it('produces clearly flagged fictional fixtures with stable ids', async () => {
    const demo = new DemoProvider(() => NOW);
    const q = { from: '2026-10-17', to: '2026-10-18', zone: 'Europe/Sofia', competitions: [] };
    const a = await demo.getFixtures(q);
    const b = await demo.getFixtures(q);
    expect(a.fixtures.length).toBeGreaterThan(0);
    expect(a.fixtures.every((f) => f.isDemo && f.competition === 'DEMO' && f.home.name.startsWith('Демо'))).toBe(true);
    expect(a.fixtures.map((f) => f.id)).toEqual(b.fixtures.map((f) => f.id));
    expect(a.meta.freshness).toBe('demo');
    const ds = await demo.getLeagueDataset('DEMO', a.fixtures[0]!.season);
    expect(ds.dataset.isDemo).toBe(true);
    expect(ds.dataset.matches.length).toBeGreaterThan(40);
  });
});
