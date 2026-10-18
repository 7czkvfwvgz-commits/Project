import { getCompetition } from '@/config/competitions';
import type { Fixture } from '@/domain/types';
import type { Msg } from '@/i18n/types';
import { confidenceForMarket, type Confidence, type Grade, type Level } from './assessment';
import type { SelectionEstimate } from './markets';
import { findEstimate } from './markets';
import { evaluateQuote, type OddsQuote } from './odds';
import type { MatchPrediction } from './predict';
import { selectionScope, type MarketKey } from './settlement';
import type { TeamSummary } from './teamStats';

export type RankingKind =
  | 'top_probability'
  | 'over15'
  | 'over25'
  | 'under35'
  | 'btts'
  | 'result'
  | 'positive_ev'
  | 'data_quality'
  | 'uncertain';

export const RANKING_KINDS: RankingKind[] = [
  'top_probability',
  'over15',
  'over25',
  'under35',
  'btts',
  'result',
  'positive_ev',
  'data_quality',
  'uncertain',
];

export type RankingSort = 'probability' | 'ev' | 'kickoff' | 'confidence';

export interface RankingFilters {
  competitions: string[];
  countries: string[];
  markets: MarketKey[];
  minProbability: number;
  minGrade: Grade | null;
  minConfidence: Level | null;
  /** Only applied where a valid, current quote exists. */
  minEv: number | null;
}

export const DEFAULT_FILTERS: RankingFilters = {
  competitions: [],
  countries: [],
  markets: [],
  minProbability: 0,
  minGrade: null,
  minConfidence: null,
  minEv: null,
};

export interface RankingInput {
  fixture: Fixture;
  prediction: MatchPrediction;
  quotes: OddsQuote[];
  home: TeamSummary;
  away: TeamSummary;
}

export interface RankedItem {
  id: string;
  fixture: Fixture;
  prediction: MatchPrediction;
  estimate: SelectionEstimate;
  confidence: Confidence;
  quote: OddsQuote | null;
  implied: number | null;
  ev: number | null;
  reasons: Msg[];
  counter: Msg;
}

const GRADE_ORDER: Grade[] = ['D', 'C', 'B', 'A'];
const LEVEL_ORDER: Level[] = ['low', 'medium', 'high'];

/** Markets considered for "highest probability"; trivially likely lines (O0.5, U4.5+) are excluded. */
const HEADLINE_KEYS = [
  '1X2:H', '1X2:D', '1X2:A', 'DC:1X', 'DC:X2', 'DC:12', 'OU:1.5:O', 'OU:1.5:U', 'OU:2.5:O', 'OU:2.5:U', 'OU:3.5:O', 'OU:3.5:U', 'BTTS:Y', 'BTTS:N',
];

const pct = (p: number) => Math.round(p * 100);
const fmt = (n: number) => n.toFixed(2);

function teamFreq(s: TeamSummary, key: 'over15' | 'over25' | 'over35' | 'btts' | 'cleanSheets' | 'failedToScore') {
  const f = s.last10Freq;
  return { k: Math.round(f[key] * f.sample), n: f.sample, share: f[key] };
}

function reasonsFor(input: RankingInput, est: SelectionEstimate): Msg[] {
  const { prediction: p, home, away } = input;
  const out: Msg[] = [{ key: 'why.modelProbability', params: { p: pct(est.probability) } }];
  const total = p.lambdaHome + p.lambdaAway;
  const sel = est.selection;
  if (sel.market === 'OU' || sel.market === 'BTTS') {
    out.push({ key: 'why.expectedGoals', params: { total: fmt(total), home: fmt(p.lambdaHome), away: fmt(p.lambdaAway) } });
    const stat = sel.market === 'BTTS' ? 'btts' : sel.line === 1.5 ? 'over15' : sel.line === 2.5 ? 'over25' : 'over35';
    const h = teamFreq(home, stat);
    const a = teamFreq(away, stat);
    if (h.n > 0 && a.n > 0) {
      out.push({
        key: sel.market === 'BTTS' ? 'why.bttsFrequency' : 'why.overFrequency',
        params: { line: sel.market === 'OU' ? sel.line : '', home: home.name, hk: h.k, hn: h.n, away: away.name, ak: a.k, an: a.n },
      });
    }
  } else if (sel.market === '1X2' || sel.market === 'DC') {
    const hr = p.ratings.home;
    const ar = p.ratings.away;
    if (hr && ar) {
      out.push({ key: 'why.strengths', params: { home: home.name, ha: fmt(hr.attack), hd: fmt(hr.defence / p.defenceLevel), away: away.name, aa: fmt(ar.attack), ad: fmt(ar.defence / p.defenceLevel) } });
    }
    out.push({ key: 'why.homeAdvantage', params: { g: fmt(p.homeAdvantage) } });
  }
  return out;
}

function counterFor(input: RankingInput, est: SelectionEstimate, confidence: Confidence): Msg {
  const { home, away } = input;
  if (confidence.level === 'low' && confidence.reasons[0]) return { key: 'counter.lowConfidence', params: { p: pct(1 - est.probability) } };
  const sel = est.selection;
  const complement = pct(1 - est.probability - est.dist.push);
  if (sel.market === 'OU') {
    const stat = sel.line === 1.5 ? 'over15' : sel.line === 2.5 ? 'over25' : 'over35';
    const h = teamFreq(home, stat);
    const a = teamFreq(away, stat);
    if (sel.pick === 'O') {
      const weaker = h.share <= a.share ? { name: home.name, ...h } : { name: away.name, ...a };
      if (weaker.n > 0) return { key: 'counter.lowScoringTeam', params: { team: weaker.name, k: weaker.k, n: weaker.n, line: sel.line, p: complement } };
    } else {
      const stronger = h.share >= a.share ? { name: home.name, ...h } : { name: away.name, ...a };
      if (stronger.n > 0) return { key: 'counter.highScoringTeam', params: { team: stronger.name, k: stronger.k, n: stronger.n, line: sel.line, p: complement } };
    }
  }
  if (sel.market === 'BTTS') {
    const h = teamFreq(home, sel.pick === 'Y' ? 'failedToScore' : 'btts');
    const a = teamFreq(away, sel.pick === 'Y' ? 'failedToScore' : 'btts');
    const worst = h.share >= a.share ? { name: home.name, ...h } : { name: away.name, ...a };
    if (worst.n > 0) {
      return { key: sel.pick === 'Y' ? 'counter.failedToScore' : 'counter.bttsHappens', params: { team: worst.name, k: worst.k, n: worst.n, p: complement } };
    }
  }
  if (sel.market === '1X2' && sel.pick !== 'D') {
    return { key: 'counter.drawRisk', params: { d: pct(input.prediction.book.result.selections.find((s) => s.key === '1X2:D')?.probability ?? 0), p: complement } };
  }
  return { key: 'counter.complement', params: { p: complement } };
}

function selectionsFor(kind: RankingKind, input: RankingInput): SelectionEstimate[] {
  const book = input.prediction.book;
  const get = (k: string) => findEstimate(book, k);
  const single = (k: string) => [get(k)].filter((x): x is SelectionEstimate => !!x);
  switch (kind) {
    case 'over15':
      return single('OU:1.5:O');
    case 'over25':
      return single('OU:2.5:O');
    case 'under35':
      return single('OU:3.5:U');
    case 'btts':
      return single('BTTS:Y');
    case 'result':
    case 'data_quality':
    case 'uncertain': {
      const best = book.result.selections.filter((s) => s.selection.market === '1X2').sort((a, b) => b.probability - a.probability)[0];
      return best ? [best] : [];
    }
    case 'top_probability': {
      const best = HEADLINE_KEYS.map(get)
        .filter((x): x is SelectionEstimate => !!x)
        .sort((a, b) => b.probability - a.probability)[0];
      return best ? [best] : [];
    }
    case 'positive_ev': {
      const keys = new Set(input.quotes.map((q) => q.selectionKey));
      return [...keys].map(get).filter((x): x is SelectionEstimate => !!x);
    }
  }
}

function entropy(p: MatchPrediction): number {
  return p.book.result.selections
    .filter((s) => s.selection.market === '1X2')
    .reduce((s, x) => (x.probability > 0 ? s - x.probability * Math.log(x.probability) : s), 0);
}

export function rankSelections(
  inputs: RankingInput[],
  kind: RankingKind,
  filters: RankingFilters,
  sort: RankingSort,
  nowMs: number,
): RankedItem[] {
  const items: RankedItem[] = [];
  for (const input of inputs) {
    const { fixture, prediction } = input;
    if (fixture.status !== 'scheduled') continue;
    if (prediction.issues.length > 0 || prediction.fallback === 'global_default') continue;
    const comp = getCompetition(fixture.competition);
    if (filters.competitions.length && !filters.competitions.includes(fixture.competition)) continue;
    if (filters.countries.length && (!comp || !filters.countries.includes(comp.country.code))) continue;
    if (filters.minGrade && GRADE_ORDER.indexOf(prediction.quality.grade) < GRADE_ORDER.indexOf(filters.minGrade)) continue;

    for (const est of selectionsFor(kind, input)) {
      if (filters.markets.length && !filters.markets.includes(est.selection.market)) continue;
      if (kind !== 'data_quality' && kind !== 'uncertain' && est.probability < filters.minProbability) continue;
      const confidence = confidenceForMarket(prediction.confidence, selectionScope(est.selection), est.group);
      if (filters.minConfidence && LEVEL_ORDER.indexOf(confidence.level) < LEVEL_ORDER.indexOf(filters.minConfidence)) continue;

      const quotes = input.quotes.filter((q) => q.selectionKey === est.key);
      let quote: OddsQuote | null = null;
      let ev: number | null = null;
      let implied: number | null = null;
      for (const q of quotes) {
        const e = evaluateQuote(est.dist, q, nowMs, fixture.kickoffUtc);
        if (e.ev !== null && (ev === null || e.ev > ev)) {
          ev = e.ev;
          quote = q;
          implied = e.implied;
        }
      }
      if (kind === 'positive_ev' && (ev === null || ev <= 0)) continue;
      if (filters.minEv !== null && ev !== null && ev < filters.minEv) continue;

      const reasons = reasonsFor(input, est);
      if (quote && ev !== null) {
        reasons.push({ key: 'why.value', params: { odds: quote.decimal.toFixed(2), fair: (1 / Math.max(est.probability, 1e-9)).toFixed(2), ev: (ev * 100).toFixed(1) } });
      }
      if (kind === 'uncertain') reasons.unshift({ key: 'why.uncertain', params: { score: confidence.score } });
      if (kind === 'data_quality') reasons.unshift({ key: 'why.quality', params: { grade: prediction.quality.grade, score: prediction.quality.score } });

      items.push({
        id: `${fixture.id}#${est.key}`,
        fixture,
        prediction,
        estimate: est,
        confidence,
        quote,
        implied,
        ev,
        reasons,
        counter: counterFor(input, est, confidence),
      });
    }
  }

  const kickoff = (i: RankedItem) => i.fixture.kickoffUtc ?? Number.MAX_SAFE_INTEGER;
  if (kind === 'data_quality') return items.sort((a, b) => b.prediction.quality.score - a.prediction.quality.score || kickoff(a) - kickoff(b));
  if (kind === 'uncertain') {
    return items
      .filter((i) => i.confidence.level === 'low' || entropy(i.prediction) > 1.05)
      .sort((a, b) => a.confidence.score - b.confidence.score || entropy(b.prediction) - entropy(a.prediction));
  }
  const bySort: Record<RankingSort, (a: RankedItem, b: RankedItem) => number> = {
    probability: (a, b) => b.estimate.probability - a.estimate.probability,
    ev: (a, b) => (b.ev ?? -Infinity) - (a.ev ?? -Infinity) || b.estimate.probability - a.estimate.probability,
    kickoff: (a, b) => kickoff(a) - kickoff(b),
    confidence: (a, b) => b.confidence.score - a.confidence.score || b.estimate.probability - a.estimate.probability,
  };
  return items.sort(bySort[sort]);
}
