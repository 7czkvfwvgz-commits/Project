/**
 * API-key proxy for the mobile app.
 *
 * Why it exists: football-data.org and The Odds API keys must not ship inside
 * the iOS bundle. This handler is the only place that knows them. It exposes a
 * small whitelist of read-only endpoints, validates every parameter, caches
 * upstream responses (serving stale data when the upstream fails), limits
 * requests per client, and keeps upstream calls within the free-tier limits.
 *
 * It is a standard fetch handler (Request → Response) so the same code runs on
 * Node (src/node.ts) or a Cloudflare Worker (src/worker.ts).
 */

export interface Env {
  FOOTBALL_DATA_API_KEY?: string;
  ODDS_API_KEY?: string;
  /** If set, requests must carry the same value in X-Client-Token. */
  CLIENT_TOKEN?: string;
}

export interface Deps {
  fetch: typeof fetch;
  now: () => number;
}

const FD_BASE = 'https://api.football-data.org/v4';
const ODDS_BASE = 'https://api.the-odds-api.com/v4';

/** Competitions available on the football-data.org free tier. */
export const FD_COMPETITIONS = new Set(['PL', 'ELC', 'BL1', 'SA', 'PD', 'FL1', 'DED', 'PPL', 'CL', 'BSA', 'WC', 'EC']);

export const ODDS_SPORTS = new Set([
  'soccer_epl',
  'soccer_efl_champ',
  'soccer_england_league1',
  'soccer_england_league2',
  'soccer_germany_bundesliga',
  'soccer_germany_bundesliga2',
  'soccer_spain_la_liga',
  'soccer_spain_segunda_division',
  'soccer_italy_serie_a',
  'soccer_italy_serie_b',
  'soccer_france_ligue_one',
  'soccer_france_ligue_two',
  'soccer_netherlands_eredivisie',
  'soccer_portugal_primeira_liga',
  'soccer_spl',
  'soccer_belgium_first_div',
  'soccer_austria_bundesliga',
  'soccer_greece_super_league',
  'soccer_turkey_super_league',
  'soccer_brazil_campeonato',
  'soccer_uefa_champs_league',
]);

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** football-data.org free tier allows 10 requests/minute; keep a margin. */
const FD_UPSTREAM_PER_MINUTE = 8;
const CLIENT_PER_MINUTE = 60;
/** The Odds API free plan has a small monthly quota, so odds are cached for hours. */
const ODDS_TTL = 3 * 60 * MINUTE;
const STANDINGS_TTL = 30 * MINUTE;
const MAX_STALE = 2 * DAY;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  status: number;
  body: string;
  headers: Record<string, string>;
  storedAt: number;
  ttl: number;
}

class SlidingWindow {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit and returns 0 if allowed, otherwise seconds until a slot frees up. */
  take(key: string, now: number): number {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.ceil((this.windowMs - (now - (recent[0] as number))) / 1000);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return 0;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(s: string | null): s is string {
  if (!s || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(), ...extra },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Client-Token, If-None-Match, Content-Type',
  };
}

function clientKey(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

export function createHandler(env: Env, deps: Deps) {
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<CacheEntry>>();
  const fdUpstream = new SlidingWindow(FD_UPSTREAM_PER_MINUTE, MINUTE);
  const clients = new SlidingWindow(CLIENT_PER_MINUTE, MINUTE);

  function remember(key: string, entry: CacheEntry) {
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    cache.set(key, entry);
  }

  /**
   * Fetch `url` once per TTL. Upstream failures fall back to a cached copy
   * (marked STALE) when one exists. The URL may contain a key, so it is never
   * included in responses or error messages.
   */
  async function cached(
    cacheKey: string,
    url: string,
    init: RequestInit,
    ttl: number,
    passHeaders: string[],
    limiter?: SlidingWindow,
  ): Promise<Response> {
    const now = deps.now();
    const hit = cache.get(cacheKey);
    if (hit && now - hit.storedAt < hit.ttl) {
      return new Response(hit.body, { status: hit.status, headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT', ...hit.headers, ...corsHeaders() } });
    }
    const serveStale = (reason: string) =>
      hit && now - hit.storedAt < MAX_STALE
        ? new Response(hit.body, { status: hit.status, headers: { 'Content-Type': 'application/json', 'X-Cache': 'STALE', 'X-Stale-Reason': reason, ...hit.headers, ...corsHeaders() } })
        : null;

    let pending = inFlight.get(cacheKey);
    if (!pending) {
      if (limiter) {
        const wait = limiter.take('upstream', now);
        if (wait > 0) return serveStale('rate_limited') ?? json(429, { error: 'rate_limited', message: 'Upstream free-tier limit reached' }, { 'Retry-After': String(wait) });
      }
      pending = (async () => {
        const res = await deps.fetch(url, init);
        const body = await res.text();
        const headers: Record<string, string> = {};
        for (const h of passHeaders) {
          const v = res.headers.get(h);
          if (v !== null) headers[`X-Upstream-${h}`] = v;
        }
        return { status: res.status, body, headers, storedAt: deps.now(), ttl };
      })().finally(() => inFlight.delete(cacheKey));
      inFlight.set(cacheKey, pending);
    }

    let entry: CacheEntry;
    try {
      entry = await pending;
    } catch {
      return serveStale('upstream_unavailable') ?? json(502, { error: 'upstream_unavailable', message: 'Upstream did not respond' });
    }
    if (entry.status === 200) {
      remember(cacheKey, entry);
      return new Response(entry.body, { status: 200, headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS', ...entry.headers, ...corsHeaders() } });
    }
    if (entry.status === 429) {
      return serveStale('rate_limited') ?? json(429, { error: 'rate_limited', message: 'Upstream rate limit reached' }, { 'Retry-After': '60' });
    }
    if (entry.status === 401 || entry.status === 403) {
      return json(502, { error: 'upstream_unauthorized', message: 'The proxy’s API key was rejected or lacks access to this resource' });
    }
    if (entry.status === 404) return json(404, { error: 'not_found', message: 'Not found upstream' });
    return serveStale(`upstream_${entry.status}`) ?? json(502, { error: 'upstream_error', status: entry.status });
  }

  function fdTtl(dateFrom: string, dateTo: string): number {
    const today = new Date(deps.now()).toISOString().slice(0, 10);
    if (dateTo < today) return 6 * 60 * MINUTE;
    if (dateFrom > today) return 10 * MINUTE;
    return MINUTE;
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (path === '/v1/health') {
      return json(200, {
        ok: true,
        time: new Date(deps.now()).toISOString(),
        providers: { footballData: { configured: !!env.FOOTBALL_DATA_API_KEY }, odds: { configured: !!env.ODDS_API_KEY } },
      });
    }

    if (env.CLIENT_TOKEN && req.headers.get('x-client-token') !== env.CLIENT_TOKEN) return json(401, { error: 'unauthorized' });
    const wait = clients.take(clientKey(req), deps.now());
    if (wait > 0) return json(429, { error: 'rate_limited', message: 'Too many requests from this client' }, { 'Retry-After': String(wait) });

    if (path === '/v1/fd/matches') {
      if (!env.FOOTBALL_DATA_API_KEY) return json(503, { error: 'missing_credentials', message: 'FOOTBALL_DATA_API_KEY is not configured on the proxy' });
      const dateFrom = url.searchParams.get('dateFrom');
      const dateTo = url.searchParams.get('dateTo');
      if (!isDate(dateFrom) || !isDate(dateTo) || dateFrom > dateTo) return json(400, { error: 'bad_request', message: 'dateFrom and dateTo must be YYYY-MM-DD with dateFrom ≤ dateTo' });
      if ((Date.parse(dateTo) - Date.parse(dateFrom)) / DAY > 10) return json(400, { error: 'bad_request', message: 'Date range is limited to 10 days' });
      return cached(
        `fd:matches:${dateFrom}:${dateTo}`,
        `${FD_BASE}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
        { headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY } },
        fdTtl(dateFrom, dateTo),
        [],
        fdUpstream,
      );
    }

    const standings = /^\/v1\/fd\/competitions\/([A-Z0-9]{2,4})\/standings$/.exec(path);
    if (standings) {
      if (!env.FOOTBALL_DATA_API_KEY) return json(503, { error: 'missing_credentials', message: 'FOOTBALL_DATA_API_KEY is not configured on the proxy' });
      const code = standings[1] as string;
      if (!FD_COMPETITIONS.has(code)) return json(404, { error: 'not_found', message: 'Competition not available on the free tier' });
      return cached(`fd:standings:${code}`, `${FD_BASE}/competitions/${code}/standings`, { headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY } }, STANDINGS_TTL, [], fdUpstream);
    }

    const odds = /^\/v1\/odds\/([a-z0-9_]+)$/.exec(path);
    if (odds) {
      if (!env.ODDS_API_KEY) return json(503, { error: 'missing_credentials', message: 'ODDS_API_KEY is not configured on the proxy' });
      const sport = odds[1] as string;
      if (!ODDS_SPORTS.has(sport)) return json(404, { error: 'not_found', message: 'Unsupported sport key' });
      const params = new URLSearchParams({ apiKey: env.ODDS_API_KEY, regions: 'eu', markets: 'h2h,totals', oddsFormat: 'decimal', dateFormat: 'iso' });
      return cached(`odds:${sport}`, `${ODDS_BASE}/sports/${sport}/odds?${params}`, {}, ODDS_TTL, ['x-requests-remaining', 'x-requests-used']);
    }

    return json(404, { error: 'not_found' });
  };
}
