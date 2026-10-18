import { z } from 'zod';
import { COMPETITIONS, getCompetition } from '@/config/competitions';
import { TEAM_MATCH_THRESHOLD, teamSimilarity } from '@/domain/teams';
import type { Fixture } from '@/domain/types';
import { isValidDecimalOdds, type OddsQuote } from '@/engine/odds';
import { isQuarterLine } from '@/engine/settlement';
import { cachedFetchJson, type CacheStore } from '../cache';
import { ProviderError } from '../errors';
import type { FetchLike } from '../http';
import { fieldMap, type OddsProvider, type ProviderCapabilities, type ResultMeta } from '../types';

/**
 * The Odds API v4 (free plan: a small monthly credit quota). Only the
 * "featured" markets h2h (1X2) and totals are requested, region "eu", decimal
 * odds. Requests go through our proxy, which keeps the key and caches
 * responses for hours to stay inside the free quota.
 */
const outcome = z.object({ name: z.string(), price: z.number(), point: z.number().optional() });
const market = z.object({ key: z.string(), last_update: z.string().optional(), outcomes: z.array(outcome) });
const bookmaker = z.object({ key: z.string(), title: z.string(), last_update: z.string(), markets: z.array(market) });
export const oddsEventSchema = z.object({
  id: z.string(),
  sport_key: z.string(),
  commence_time: z.string().refine((s) => Number.isFinite(Date.parse(s)), 'invalid commence_time'),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(bookmaker),
});
export type OddsEvent = z.infer<typeof oddsEventSchema>;
export const oddsResponseSchema = z.array(z.unknown());

const MAX_KICKOFF_GAP_MS = 3 * 3_600_000;

/**
 * Find the event for a fixture: both team names must match on the same sides
 * and the kickoff must agree. A swapped or uncertain match returns null —
 * prices for the wrong fixture would be worse than no prices.
 */
export function matchOddsEvent(fixture: Fixture, events: OddsEvent[]): OddsEvent | null {
  let best: { e: OddsEvent; score: number } | null = null;
  for (const e of events) {
    const commence = Date.parse(e.commence_time);
    if (fixture.kickoffUtc !== null) {
      if (Math.abs(commence - fixture.kickoffUtc) > MAX_KICKOFF_GAP_MS) continue;
    } else if (Math.abs(commence - Date.parse(`${fixture.sourceDate}T12:00:00Z`)) > 18 * 3_600_000) continue;
    const h = teamSimilarity(fixture.home.name, e.home_team);
    const a = teamSimilarity(fixture.away.name, e.away_team);
    if (h < TEAM_MATCH_THRESHOLD || a < TEAM_MATCH_THRESHOLD) continue;
    const score = h + a;
    if (!best || score > best.score) best = { e, score };
  }
  return best?.e ?? null;
}

export function quotesFromEvent(e: OddsEvent, fetchedAt: number): OddsQuote[] {
  const quotes: OddsQuote[] = [];
  for (const b of e.bookmakers) {
    for (const m of b.markets) {
      const quotedAt = Date.parse(m.last_update ?? b.last_update);
      if (!Number.isFinite(quotedAt)) continue;
      for (const o of m.outcomes) {
        if (!isValidDecimalOdds(o.price)) continue;
        let key: string | null = null;
        if (m.key === 'h2h') {
          key = o.name === e.home_team ? '1X2:H' : o.name === e.away_team ? '1X2:A' : o.name === 'Draw' ? '1X2:D' : null;
        } else if (m.key === 'totals' && typeof o.point === 'number' && Number.isInteger(o.point * 4) && !isQuarterLine(o.point)) {
          key = o.name === 'Over' ? `OU:${o.point}:O` : o.name === 'Under' ? `OU:${o.point}:U` : null;
        }
        if (key) quotes.push({ selectionKey: key, decimal: o.price, bookmaker: b.title, provider: 'the-odds-api', quotedAt, fetchedAt });
      }
    }
  }
  return quotes;
}

export interface TheOddsApiOptions {
  proxyUrl: string | null;
  clientToken?: string | null;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class TheOddsApiProvider implements OddsProvider {
  readonly id = 'the-odds-api' as const;

  constructor(
    private readonly store: CacheStore,
    private readonly options: TheOddsApiOptions,
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      id: this.id,
      roles: ['odds'],
      fields: fieldMap({ odds_1x2: 'supported', odds_totals: 'supported' }),
      dataKind: 'live',
      requiresCredentials: true,
      configured: !!this.options.proxyUrl,
      competitions: COMPETITIONS.filter((c) => c.oddsApi).map((c) => c.code),
      homepage: 'https://the-odds-api.com',
      terms: 'Free plan with a small monthly request quota; current pre-match odds only. Key stays on the proxy server.',
      attribution: 'Odds: The Odds API',
    };
  }

  async getOdds(fixture: Fixture, signal?: AbortSignal): Promise<{ quotes: OddsQuote[]; meta: ResultMeta }> {
    if (!this.options.proxyUrl) throw new ProviderError(this.id, 'missing_credentials', 'Proxy URL not configured');
    const sport = getCompetition(fixture.competition)?.oddsApi;
    const now = (this.options.now ?? Date.now)();
    if (!sport) return { quotes: [], meta: { provider: this.id, fetchedAt: now, freshness: 'unavailable', stale: false } };
    const result = await cachedFetchJson(this.store, {
      url: `${this.options.proxyUrl}/v1/odds/${sport}`,
      provider: this.id,
      ttlMs: 30 * 60_000,
      headers: this.options.clientToken ? { 'X-Client-Token': this.options.clientToken } : {},
      parse: (json) => oddsResponseSchema.parse(json),
      fetchImpl: this.options.fetchImpl,
      now: this.options.now,
      signal,
    });
    const events = (result.data ?? []).map((e) => oddsEventSchema.safeParse(e)).flatMap((r) => (r.success ? [r.data] : []));
    const event = matchOddsEvent(fixture, events);
    return {
      quotes: event ? quotesFromEvent(event, result.fetchedAt) : [],
      meta: { provider: this.id, fetchedAt: result.fetchedAt, freshness: result.fromCache || result.stale ? 'cached' : 'live', stale: result.stale, error: result.error },
    };
  }
}
