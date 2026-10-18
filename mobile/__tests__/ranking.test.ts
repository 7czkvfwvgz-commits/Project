import { explainMatch } from '@/engine/explain';
import { fitLeagueModel } from '@/engine/fit';
import type { OddsQuote } from '@/engine/odds';
import { predictMatch } from '@/engine/predict';
import { DEFAULT_FILTERS, rankSelections, RANKING_KINDS, type RankingInput } from '@/engine/ranking';
import { computeStandings, headToHead, summarizeTeam } from '@/engine/teamStats';
import { translateMsg } from '@/i18n';
import { makeTeams, mulberry32, syntheticLeague } from '../test-utils/synthetic';

const NOW = Date.UTC(2026, 0, 10, 9);

function setup() {
  const teams = makeTeams(12, mulberry32(21));
  const { dataset, fixtures } = syntheticLeague([{ season: '2025-26', start: '2025-08-16', teams, playedRounds: 20 }], 1.3, 4);
  const upcoming = fixtures.filter((f) => f.status === 'scheduled').slice(0, 6);
  const asOf = upcoming[0]!.sourceDate;
  const model = fitLeagueModel(dataset, asOf, '2025-26');
  const inputs: RankingInput[] = upcoming.map((fixture) => ({
    fixture,
    prediction: predictMatch({ fixture, dataset, model, nowMs: NOW, validated: true }),
    quotes: [],
    home: summarizeTeam(dataset, fixture.home.key, asOf, '2025-26'),
    away: summarizeTeam(dataset, fixture.away.key, asOf, '2025-26'),
  }));
  return { dataset, inputs, asOf };
}

describe('ranking', () => {
  const { dataset, inputs, asOf } = setup();

  it('sorts by probability and explains every item', () => {
    const items = rankSelections(inputs, 'over15', DEFAULT_FILTERS, 'probability', NOW);
    expect(items.length).toBe(inputs.length);
    for (let i = 1; i < items.length; i++) expect(items[i]!.estimate.probability).toBeLessThanOrEqual(items[i - 1]!.estimate.probability);
    for (const item of items) {
      expect(item.estimate.key).toBe('OU:1.5:O');
      expect(item.reasons.length).toBeGreaterThan(0);
      expect(item.counter.key).toMatch(/^counter\./);
    }
  });

  it('applies the minimum probability filter and reports nothing when nothing qualifies', () => {
    const none = rankSelections(inputs, 'btts', { ...DEFAULT_FILTERS, minProbability: 0.99 }, 'probability', NOW);
    expect(none).toEqual([]);
  });

  it('needs valid odds for the positive-EV ranking', () => {
    expect(rankSelections(inputs, 'positive_ev', DEFAULT_FILTERS, 'ev', NOW)).toEqual([]);
    const target = inputs[0]!;
    const p = target.prediction.book.goals.selections.find((s) => s.key === 'OU:2.5:O')!.probability;
    const generous: OddsQuote = {
      selectionKey: 'OU:2.5:O',
      decimal: (1 / p) * 1.2,
      bookmaker: null,
      provider: 'manual',
      quotedAt: NOW - 1000,
      fetchedAt: NOW - 1000,
    };
    const withOdds = inputs.map((i, idx) => (idx === 0 ? { ...i, quotes: [generous] } : i));
    const items = rankSelections(withOdds, 'positive_ev', DEFAULT_FILTERS, 'ev', NOW);
    expect(items).toHaveLength(1);
    expect(items[0]!.ev).toBeCloseTo(0.2, 6);
    expect(items[0]!.reasons.map((r) => r.key)).toContain('why.value');
  });

  it('ignores stale odds for EV', () => {
    const stale: OddsQuote = { selectionKey: '1X2:H', decimal: 50, bookmaker: 'B', provider: 'the-odds-api', quotedAt: NOW - 24 * 3_600_000, fetchedAt: NOW };
    const items = rankSelections([{ ...inputs[0]!, quotes: [stale] }], 'positive_ev', DEFAULT_FILTERS, 'ev', NOW);
    expect(items).toEqual([]);
  });

  it('excludes matches that are not upcoming', () => {
    const finished = inputs.map((i) => ({ ...i, fixture: { ...i.fixture, status: 'finished' as const } }));
    expect(rankSelections(finished, 'top_probability', DEFAULT_FILTERS, 'probability', NOW)).toEqual([]);
  });

  it('filters by competition', () => {
    expect(rankSelections(inputs, 'result', { ...DEFAULT_FILTERS, competitions: ['GER1'] }, 'probability', NOW)).toEqual([]);
    expect(rankSelections(inputs, 'result', { ...DEFAULT_FILTERS, competitions: ['ENG1'] }, 'probability', NOW).length).toBe(inputs.length);
  });

  it('produces translatable text for every ranking kind in both languages', () => {
    for (const kind of RANKING_KINDS) {
      for (const item of rankSelections(inputs, kind, DEFAULT_FILTERS, 'probability', NOW)) {
        for (const msg of [...item.reasons, item.counter]) {
          for (const lang of ['bg', 'en'] as const) {
            const text = translateMsg(lang, msg);
            expect(text).not.toMatch(/\{\w+\}/);
            expect(text).not.toMatch(/undefined|NaN/);
          }
        }
      }
    }
  });

  it('builds a complete rule-based explanation with no unfilled values', () => {
    const input = inputs[0]!;
    const explanation = explainMatch({
      fixture: input.fixture,
      prediction: input.prediction,
      home: input.home,
      away: input.away,
      standings: computeStandings(dataset, '2025-26', asOf),
      h2h: headToHead(dataset, input.fixture.home.key, input.fixture.away.key, asOf),
    });
    expect(explanation.generator).toBe('rules');
    expect(explanation.sections.map((s) => s.id)).toEqual(['form', 'strengths', 'expected_goals', 'probabilities', 'support', 'conflict', 'limitations', 'failure']);
    for (const section of explanation.sections) {
      expect(section.items.length).toBeGreaterThan(0);
      for (const msg of section.items) {
        const text = translateMsg('bg', msg);
        expect(text).not.toMatch(/\{\w+\}|undefined|NaN/);
      }
    }
  });
});
