import type { ProviderId } from '@/domain/types';
import type { Outcome } from './settlement';

export type OutcomeDistribution = Record<Outcome, number>;

export const EMPTY_DISTRIBUTION: OutcomeDistribution = { win: 0, half_win: 0, push: 0, half_loss: 0, loss: 0 };

/** Pre-match quotes older than this are treated as stale and excluded from EV. */
export const ODDS_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const MIN_DECIMAL_ODDS = 1.01;
export const MAX_DECIMAL_ODDS = 1000;

export interface OddsQuote {
  selectionKey: string;
  decimal: number;
  /** Bookmaker name exactly as reported by the provider; "manual" quotes carry none. */
  bookmaker: string | null;
  provider: ProviderId;
  /** When the price was last updated at the source. */
  quotedAt: number;
  /** When the app received it. */
  fetchedAt: number;
}

export function isValidDecimalOdds(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_DECIMAL_ODDS && value <= MAX_DECIMAL_ODDS;
}

/** Implied probability = 1 / decimal odds (includes the bookmaker margin). */
export function impliedProbability(decimal: number): number {
  if (!isValidDecimalOdds(decimal)) throw new RangeError(`Invalid decimal odds ${decimal}`);
  return 1 / decimal;
}

export function fairOdds(probability: number): number | null {
  return probability > 0 && probability <= 1 ? 1 / probability : null;
}

/**
 * Bookmaker margin (overround) of a complete set of mutually exclusive outcomes
 * from one bookmaker, e.g. 1/X/2 or Over/Under on one line.
 */
export function bookMargin(decimals: number[]): number {
  if (decimals.length < 2 || !decimals.every(isValidDecimalOdds)) throw new RangeError('A complete book needs ≥2 valid prices');
  return decimals.reduce((s, d) => s + 1 / d, 0) - 1;
}

/** Margin-free probabilities by proportional normalisation of implied probabilities. */
export function fairProbabilities(decimals: number[]): number[] {
  const implied = decimals.map(impliedProbability);
  const total = implied.reduce((s, p) => s + p, 0);
  return implied.map((p) => p / total);
}

/**
 * Expected net return per unit stake given the model's settlement distribution.
 * For a plain win/lose market this is p × odds − 1.
 */
export function expectedValue(dist: OutcomeDistribution, decimal: number): number {
  if (!isValidDecimalOdds(decimal)) throw new RangeError(`Invalid decimal odds ${decimal}`);
  return (
    dist.win * (decimal - 1) +
    dist.half_win * ((decimal - 1) / 2) -
    dist.half_loss * 0.5 -
    dist.loss
  );
}

export type QuoteState = 'ok' | 'stale' | 'kickoff_passed' | 'invalid';

export function quoteState(quote: OddsQuote, nowMs: number, kickoffUtc: number | null): QuoteState {
  if (!isValidDecimalOdds(quote.decimal)) return 'invalid';
  if (kickoffUtc !== null && nowMs >= kickoffUtc) return 'kickoff_passed';
  if (nowMs - quote.quotedAt > ODDS_MAX_AGE_MS) return 'stale';
  return 'ok';
}

export interface QuoteEvaluation {
  implied: number | null;
  state: QuoteState;
  /** Null whenever EV is not meaningful (stale/invalid quote). */
  ev: number | null;
}

export function evaluateQuote(dist: OutcomeDistribution, quote: OddsQuote, nowMs: number, kickoffUtc: number | null): QuoteEvaluation {
  const state = quoteState(quote, nowMs, kickoffUtc);
  if (state === 'invalid') return { implied: null, state, ev: null };
  const implied = impliedProbability(quote.decimal);
  return { implied, state, ev: state === 'ok' ? expectedValue(dist, quote.decimal) : null };
}

/** Best (highest) valid, non-stale price per selection. */
export function bestQuotes(quotes: OddsQuote[], nowMs: number, kickoffUtc: number | null): Map<string, OddsQuote> {
  const best = new Map<string, OddsQuote>();
  for (const q of quotes) {
    if (quoteState(q, nowMs, kickoffUtc) !== 'ok') continue;
    const current = best.get(q.selectionKey);
    if (!current || q.decimal > current.decimal) best.set(q.selectionKey, q);
  }
  return best;
}

/** Complete books (same bookmaker, same market line) used to measure margin. */
export const COMPLETE_BOOKS: string[][] = [
  ['1X2:H', '1X2:D', '1X2:A'],
  ...[0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map((l) => [`OU:${l}:O`, `OU:${l}:U`]),
  ['BTTS:Y', 'BTTS:N'],
];

export interface BookSummary {
  bookmaker: string | null;
  provider: ProviderId;
  keys: string[];
  margin: number;
  fair: Record<string, number>;
  quotedAt: number;
}

export function completeBooks(quotes: OddsQuote[]): BookSummary[] {
  const byBook = new Map<string, Map<string, OddsQuote>>();
  for (const q of quotes) {
    const id = `${q.provider}|${q.bookmaker ?? ''}`;
    const m = byBook.get(id) ?? new Map<string, OddsQuote>();
    m.set(q.selectionKey, q);
    byBook.set(id, m);
  }
  const out: BookSummary[] = [];
  for (const m of byBook.values()) {
    for (const keys of COMPLETE_BOOKS) {
      const qs = keys.map((k) => m.get(k));
      if (!qs.every((q): q is OddsQuote => !!q && isValidDecimalOdds(q.decimal))) continue;
      const decimals = qs.map((q) => q.decimal);
      const fair = fairProbabilities(decimals);
      const first = qs[0] as OddsQuote;
      out.push({
        bookmaker: first.bookmaker,
        provider: first.provider,
        keys,
        margin: bookMargin(decimals),
        fair: Object.fromEntries(keys.map((k, i) => [k, fair[i] as number])),
        quotedAt: Math.min(...qs.map((q) => q.quotedAt)),
      });
    }
  }
  return out;
}
