import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHandler, type Env } from '../src/handler.ts';

const NOW = Date.UTC(2026, 9, 18, 10);

function setup(env: Env, reply: (url: string, init?: RequestInit) => Response | Promise<Response> | Error) {
  let clock = NOW;
  const calls: { url: string; init?: RequestInit }[] = [];
  const handle = createHandler(env, {
    fetch: (async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const r = await reply(String(input), init);
      if (r instanceof Error) throw r;
      return r;
    }) as typeof fetch,
    now: () => clock,
  });
  const get = (path: string, headers: Record<string, string> = {}) => handle(new Request(`http://proxy.test${path}`, { headers }));
  return { get, calls, advance: (ms: number) => (clock += ms) };
}

const KEYS: Env = { FOOTBALL_DATA_API_KEY: 'fd-secret-key', ODDS_API_KEY: 'odds-secret-key' };
const ok = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers });

describe('proxy handler', () => {
  it('reports configuration without revealing keys', async () => {
    const { get } = setup(KEYS, () => ok({}));
    const res = await get('/v1/health');
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(text).providers, { footballData: { configured: true }, odds: { configured: true } });
    assert.ok(!text.includes('secret'));
  });

  it('answers missing_credentials when a key is not configured', async () => {
    const { get, calls } = setup({}, () => ok({}));
    const res = await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-19');
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'missing_credentials');
    assert.equal((await get('/v1/odds/soccer_epl')).status, 503);
    assert.equal(calls.length, 0);
  });

  it('adds the key upstream, validates parameters and caches', async () => {
    const { get, calls, advance } = setup(KEYS, () => ok({ matches: [] }));
    assert.equal((await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=bad')).status, 400);
    assert.equal((await get('/v1/fd/matches?dateFrom=2026-10-01&dateTo=2026-10-30')).status, 400);
    assert.equal((await get('/v1/fd/matches?dateFrom=2026-02-30&dateTo=2026-03-01')).status, 400);

    const first = await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-19');
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-cache'), 'MISS');
    assert.equal(calls[0]!.url, 'https://api.football-data.org/v4/matches?dateFrom=2026-10-18&dateTo=2026-10-19');
    assert.equal((calls[0]!.init!.headers as Record<string, string>)['X-Auth-Token'], 'fd-secret-key');

    const second = await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-19');
    assert.equal(second.headers.get('x-cache'), 'HIT');
    assert.equal(calls.length, 1);

    advance(2 * 60_000);
    await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-19');
    assert.equal(calls.length, 2);
  });

  it('serves stale data when the upstream fails, and 502 without a copy', async () => {
    let down = false;
    const { get, advance } = setup(KEYS, () => (down ? new Error('ECONNRESET') : ok({ matches: [1] })));
    await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-18');
    down = true;
    advance(5 * 60_000);
    const stale = await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-18');
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get('x-cache'), 'STALE');
    const none = await get('/v1/fd/matches?dateFrom=2026-10-20&dateTo=2026-10-20');
    assert.equal(none.status, 502);
    assert.ok(!(await none.text()).includes('secret'));
  });

  it('keeps upstream calls within the free-tier rate limit', async () => {
    const { get, calls } = setup(KEYS, () => ok({ matches: [] }));
    const statuses: number[] = [];
    for (let d = 1; d <= 10; d++) {
      const day = `2026-11-${String(d).padStart(2, '0')}`;
      statuses.push((await get(`/v1/fd/matches?dateFrom=${day}&dateTo=${day}`)).status);
    }
    assert.equal(calls.length, 8);
    assert.deepEqual(statuses.slice(8), [429, 429]);
  });

  it('maps upstream 429 to a rate-limit answer', async () => {
    const { get } = setup(KEYS, () => new Response('{"message":"too many"}', { status: 429 }));
    const res = await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-18');
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error, 'rate_limited');
  });

  it('only proxies whitelisted competitions and sports, and forwards the odds quota', async () => {
    const { get, calls } = setup(KEYS, () => ok([], { 'x-requests-remaining': '480' }));
    assert.equal((await get('/v1/fd/competitions/XX1/standings')).status, 404);
    assert.equal((await get('/v1/odds/basketball_nba')).status, 404);
    assert.equal((await get('/v1/anything')).status, 404);
    const odds = await get('/v1/odds/soccer_epl');
    assert.equal(odds.status, 200);
    assert.equal(odds.headers.get('x-upstream-x-requests-remaining'), '480');
    assert.match(calls[0]!.url, /^https:\/\/api\.the-odds-api\.com\/v4\/sports\/soccer_epl\/odds\?apiKey=odds-secret-key&regions=eu&markets=h2h%2Ctotals&oddsFormat=decimal/);
  });

  it('does not leak the key when the upstream rejects it', async () => {
    const { get } = setup(KEYS, () => new Response('{"message":"invalid key odds-secret-key"}', { status: 401 }));
    const res = await get('/v1/odds/soccer_epl');
    assert.equal(res.status, 502);
    assert.ok(!(await res.text()).includes('secret'));
  });

  it('requires the client token when configured and limits clients', async () => {
    const { get } = setup({ ...KEYS, CLIENT_TOKEN: 'app-token' }, () => ok({ matches: [] }));
    assert.equal((await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-18')).status, 401);
    assert.equal((await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-18', { 'X-Client-Token': 'app-token' })).status, 200);
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const r = await get('/v1/fd/matches?dateFrom=2026-10-18&dateTo=2026-10-18', { 'X-Client-Token': 'app-token', 'x-forwarded-for': '10.0.0.9' });
      if (r.status === 429) limited++;
    }
    assert.ok(limited > 0);
  });

  it('rejects non-GET methods', async () => {
    const handle = createHandler(KEYS, { fetch: globalThis.fetch, now: () => NOW });
    assert.equal((await handle(new Request('http://proxy.test/v1/health', { method: 'POST' }))).status, 405);
  });
});
