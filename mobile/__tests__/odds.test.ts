import {
  bestQuotes,
  bookMargin,
  completeBooks,
  evaluateQuote,
  expectedValue,
  fairOdds,
  fairProbabilities,
  impliedProbability,
  isValidDecimalOdds,
  ODDS_MAX_AGE_MS,
  quoteState,
  type OddsQuote,
} from '@/engine/odds';

const NOW = Date.UTC(2026, 9, 18, 10);
const quote = (over: Partial<OddsQuote> = {}): OddsQuote => ({
  selectionKey: '1X2:H',
  decimal: 2.1,
  bookmaker: 'Example Book',
  provider: 'the-odds-api',
  quotedAt: NOW - 60_000,
  fetchedAt: NOW,
  ...over,
});

describe('odds arithmetic', () => {
  it('implied probability is 1 / odds', () => {
    expect(impliedProbability(2)).toBe(0.5);
    expect(impliedProbability(1.25)).toBeCloseTo(0.8);
    expect(() => impliedProbability(1)).toThrow(RangeError);
    expect(() => impliedProbability(Number.NaN)).toThrow(RangeError);
  });

  it('validates decimal odds', () => {
    expect(isValidDecimalOdds(1.01)).toBe(true);
    expect(isValidDecimalOdds(1.0)).toBe(false);
    expect(isValidDecimalOdds(-2)).toBe(false);
    expect(isValidDecimalOdds(1001)).toBe(false);
  });

  it('computes margin and margin-free probabilities from a complete book', () => {
    const prices = [2.0, 3.4, 3.8];
    const margin = bookMargin(prices);
    expect(margin).toBeCloseTo(1 / 2 + 1 / 3.4 + 1 / 3.8 - 1, 12);
    const fair = fairProbabilities(prices);
    expect(fair.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
    expect(fair[0]).toBeCloseTo(0.5 / (1 + margin), 12);
    expect(() => bookMargin([2])).toThrow(RangeError);
  });

  it('fair odds invert probability', () => {
    expect(fairOdds(0.25)).toBe(4);
    expect(fairOdds(0)).toBeNull();
  });
});

describe('expected value', () => {
  it('is p × odds − 1 for a win/lose market', () => {
    const dist = { win: 0.55, half_win: 0, push: 0, half_loss: 0, loss: 0.45 };
    expect(expectedValue(dist, 2.0)).toBeCloseTo(0.55 * 2 - 1, 12);
    expect(expectedValue(dist, 1.7)).toBeLessThan(0);
  });

  it('accounts for pushes and half outcomes', () => {
    // Draw no bet: push returns the stake.
    const dnb = { win: 0.5, half_win: 0, push: 0.25, half_loss: 0, loss: 0.25 };
    expect(expectedValue(dnb, 1.6)).toBeCloseTo(0.5 * 0.6 - 0.25, 12);
    // Quarter line: half win / half loss.
    const quarter = { win: 0.3, half_win: 0.2, push: 0, half_loss: 0.1, loss: 0.4 };
    expect(expectedValue(quarter, 2.0)).toBeCloseTo(0.3 * 1 + 0.2 * 0.5 - 0.1 * 0.5 - 0.4, 12);
  });
});

describe('quote freshness', () => {
  const dist = { win: 0.6, half_win: 0, push: 0, half_loss: 0, loss: 0.4 };

  it('computes EV for a current quote', () => {
    const e = evaluateQuote(dist, quote(), NOW, NOW + 3_600_000);
    expect(e.state).toBe('ok');
    expect(e.ev).toBeCloseTo(0.6 * 2.1 - 1, 12);
    expect(e.implied).toBeCloseTo(1 / 2.1, 12);
  });

  it('disables EV for stale quotes but still shows implied probability', () => {
    const old = quote({ quotedAt: NOW - ODDS_MAX_AGE_MS - 1 });
    expect(quoteState(old, NOW, null)).toBe('stale');
    const e = evaluateQuote(dist, old, NOW, null);
    expect(e.ev).toBeNull();
    expect(e.implied).toBeCloseTo(1 / 2.1);
  });

  it('disables EV after kickoff', () => {
    expect(evaluateQuote(dist, quote(), NOW, NOW - 1).state).toBe('kickoff_passed');
  });

  it('rejects invalid prices', () => {
    const e = evaluateQuote(dist, quote({ decimal: 0.9 }), NOW, null);
    expect(e).toEqual({ implied: null, state: 'invalid', ev: null });
  });

  it('keeps the best current price per selection', () => {
    const best = bestQuotes(
      [quote({ decimal: 2.0 }), quote({ decimal: 2.3, bookmaker: 'B' }), quote({ decimal: 2.6, quotedAt: NOW - ODDS_MAX_AGE_MS - 5 })],
      NOW,
      null,
    );
    expect(best.get('1X2:H')?.decimal).toBe(2.3);
  });

  it('detects complete books per bookmaker', () => {
    const books = completeBooks([
      quote({ selectionKey: '1X2:H', decimal: 2.0 }),
      quote({ selectionKey: '1X2:D', decimal: 3.4 }),
      quote({ selectionKey: '1X2:A', decimal: 3.8 }),
      quote({ selectionKey: 'OU:2.5:O', decimal: 1.9 }),
    ]);
    expect(books).toHaveLength(1);
    expect(books[0]!.keys).toEqual(['1X2:H', '1X2:D', '1X2:A']);
    expect(Object.values(books[0]!.fair).reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
  });
});
