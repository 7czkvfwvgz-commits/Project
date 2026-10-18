import { findEstimate, buildMarketBook } from '@/engine/markets';
import { buildScoreMatrix, probabilityWhere } from '@/engine/scoreMatrix';
import { analyzeSlip, jointProbabilitySameMatch, settleSlip, type FixtureModel, type SlipLeg } from '@/engine/slip';

const NOW = Date.UTC(2026, 9, 18, 10);
const leg = (over: Partial<SlipLeg>): SlipLeg => ({
  fixtureId: 'f1',
  competition: 'ENG1',
  home: 'Home',
  away: 'Away',
  kickoffUtc: NOW + 3_600_000,
  selectionKey: '1X2:H',
  probability: 0.5,
  odds: 2.0,
  oddsProvider: 'manual',
  oddsBookmaker: null,
  oddsQuotedAt: NOW - 60_000,
  ...over,
});

describe('combined odds and returns', () => {
  it('multiplies odds for selections on different matches', () => {
    const a = analyzeSlip([leg({ fixtureId: 'f1', odds: 2.0, probability: 0.55 }), leg({ fixtureId: 'f2', odds: 1.5, probability: 0.7 })], 10, new Map(), NOW);
    expect(a.combinedOdds).toBeCloseTo(3.0);
    expect(a.grossReturn).toBeCloseTo(30);
    expect(a.netProfit).toBeCloseTo(20);
    expect(a.combinedProbability).toBeCloseTo(0.385);
    expect(a.probabilityMethod).toBe('independent_matches');
    expect(a.expectedValue).toBeCloseTo(0.385 * 3 - 1);
    expect(a.warnings.map((w) => w.key)).toContain('slip.independenceAssumed');
  });

  it('refuses to multiply odds without valid prices', () => {
    const a = analyzeSlip([leg({ odds: null }), leg({ fixtureId: 'f2' })], 10, new Map(), NOW);
    expect(a.combinedOdds).toBeNull();
    expect(a.combinedOddsUnavailable).toBe('missing_odds');
    expect(a.grossReturn).toBeNull();
    expect(a.expectedValue).toBeNull();
  });

  it('does not compute returns for a zero or invalid stake', () => {
    const a = analyzeSlip([leg({})], Number.NaN, new Map(), NOW);
    expect(a.combinedOdds).toBe(2);
    expect(a.grossReturn).toBeNull();
  });
});

describe('correlation', () => {
  const ft = buildScoreMatrix(1.7, 1.0, -0.1);
  const models = new Map<string, FixtureModel>([['f1', { ft, half: null }]]);

  it('never multiplies probabilities of selections from the same match', () => {
    const book = buildMarketBook(ft, null);
    const pH = findEstimate(book, '1X2:H')!.probability;
    const pO = findEstimate(book, 'OU:2.5:O')!.probability;
    const a = analyzeSlip(
      [leg({ selectionKey: '1X2:H', probability: pH }), leg({ selectionKey: 'OU:2.5:O', probability: pO })],
      10,
      models,
      NOW,
    );
    const joint = probabilityWhere(ft, (h, aw) => h > aw && h + aw > 2.5);
    expect(a.combinedProbability).toBeCloseTo(joint, 12);
    expect(a.combinedProbability).not.toBeCloseTo(pH * pO, 3);
    expect(a.probabilityMethod).toBe('joint_scoreline');
    // Same-match odds cannot be multiplied.
    expect(a.combinedOdds).toBeNull();
    expect(a.combinedOddsUnavailable).toBe('same_match');
    expect(a.correlatedFixtures).toEqual(['f1']);
    expect(a.warnings.map((w) => w.key)).toContain('slip.sameMatchOdds');
  });

  it('labels the combined probability unavailable when the joint cannot be modelled', () => {
    const a = analyzeSlip([leg({ selectionKey: '1X2:H' }), leg({ selectionKey: 'HT_1X2:H' })], 10, models, NOW);
    expect(a.combinedProbability).toBeNull();
    expect(a.probabilityUnavailable).toBe('correlation');
    expect(a.warnings.map((w) => w.key)).toContain('slip.correlationUnmodelled');
  });

  it('labels it unavailable without a model for the match', () => {
    const a = analyzeSlip([leg({ selectionKey: '1X2:H' }), leg({ selectionKey: 'BTTS:Y' })], 10, new Map(), NOW);
    expect(a.probabilityUnavailable).toBe('correlation');
  });

  it('does not report a full-win probability for markets that can push', () => {
    const a = analyzeSlip([leg({ selectionKey: 'AH:H:-1' })], 10, models, NOW);
    expect(a.combinedProbability).toBeNull();
    expect(a.probabilityUnavailable).toBe('non_binary');
  });

  it('joint probability of contradictory selections is zero', () => {
    expect(jointProbabilitySameMatch([{ market: '1X2', pick: 'H' }, { market: '1X2', pick: 'A' }], ft)).toBe(0);
    expect(jointProbabilitySameMatch([{ market: 'BTTS', pick: 'Y' }, { market: 'OU', line: 1.5, pick: 'U' }], ft)).toBe(0);
  });
});

describe('stale and started legs', () => {
  it('warns and disables EV', () => {
    const a = analyzeSlip(
      [leg({ oddsQuotedAt: NOW - 7 * 3_600_000 }), leg({ fixtureId: 'f2', kickoffUtc: NOW - 1 })],
      10,
      new Map(),
      NOW,
    );
    const keys = a.warnings.map((w) => w.key);
    expect(keys).toEqual(expect.arrayContaining(['slip.staleOdds', 'slip.started']));
    expect(a.expectedValue).toBeNull();
    expect(a.combinedOdds).not.toBeNull();
  });
});

describe('accumulator settlement', () => {
  it('wins when every leg wins', () => {
    expect(settleSlip([leg({ outcome: 'win', odds: 2 }), leg({ outcome: 'win', odds: 1.5 })], 10)).toEqual({ status: 'won', returnAmount: 30 });
  });
  it('treats a push as odds 1', () => {
    expect(settleSlip([leg({ outcome: 'push', odds: 2 }), leg({ outcome: 'win', odds: 1.5 })], 10)).toEqual({ status: 'won', returnAmount: 15 });
  });
  it('applies half outcomes', () => {
    const r = settleSlip([leg({ outcome: 'half_win', odds: 2 }), leg({ outcome: 'half_loss', odds: 1.8 })], 10);
    expect(r.status).toBe('partial');
    expect(r.returnAmount).toBeCloseTo(10 * 1.5 * 0.5);
  });
  it('loses on any lost leg and waits for pending legs', () => {
    expect(settleSlip([leg({ outcome: 'loss' }), leg({ outcome: null })], 10)).toEqual({ status: 'lost', returnAmount: 0 });
    expect(settleSlip([leg({ outcome: 'win' }), leg({ outcome: null })], 10)).toEqual({ status: 'pending', returnAmount: null });
  });
  it('is void when every leg pushes', () => {
    expect(settleSlip([leg({ outcome: 'push' })], 10)).toEqual({ status: 'void', returnAmount: 10 });
  });
});
