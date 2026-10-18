import type { ProviderId } from '@/domain/types';
import type { Msg } from '@/i18n/types';
import type { HalfTimeModel } from './halftime';
import { isValidDecimalOdds, ODDS_MAX_AGE_MS } from './odds';
import { cell, type ScoreMatrix } from './scoreMatrix';
import { isBinaryMarket, parseSelectionKey, returnMultiplier, selectionScope, settle, type Outcome, type Selection } from './settlement';

export interface SlipLeg {
  fixtureId: string;
  competition: string;
  home: string;
  away: string;
  kickoffUtc: number | null;
  selectionKey: string;
  /** Model probability of a full win when the leg was added. */
  probability: number | null;
  odds: number | null;
  oddsProvider: ProviderId | null;
  oddsBookmaker: string | null;
  oddsQuotedAt: number | null;
  outcome?: Outcome | null;
}

export type ProbabilityMethod = 'independent_matches' | 'joint_scoreline';

export interface SlipAnalysis {
  legs: number;
  combinedOdds: number | null;
  combinedOddsUnavailable?: 'missing_odds' | 'same_match';
  grossReturn: number | null;
  netProfit: number | null;
  combinedProbability: number | null;
  probabilityUnavailable?: 'correlation' | 'missing_probability' | 'non_binary';
  probabilityMethod?: ProbabilityMethod;
  expectedValue: number | null;
  /** Fixture ids with more than one leg. */
  correlatedFixtures: string[];
  warnings: Msg[];
}

export interface FixtureModel {
  ft: ScoreMatrix;
  half: HalfTimeModel | null;
}

/**
 * Joint probability that every selection wins, for selections on the same
 * match, read directly from the full-time scoreline distribution.
 * Returns null when any selection is not a full-time binary market.
 */
export function jointProbabilitySameMatch(selections: Selection[], ft: ScoreMatrix): number | null {
  if (selections.some((s) => selectionScope(s) !== 'ft' || !isBinaryMarket(s))) return null;
  let p = 0;
  for (let h = 0; h <= ft.maxGoals; h++) {
    for (let a = 0; a <= ft.maxGoals; a++) {
      if (selections.every((s) => settle(s, { home: h, away: a }) === 'win')) p += cell(ft, h, a);
    }
  }
  return p;
}

export function analyzeSlip(legs: SlipLeg[], stake: number, models: Map<string, FixtureModel>, nowMs: number): SlipAnalysis {
  const warnings: Msg[] = [];
  const byFixture = new Map<string, SlipLeg[]>();
  for (const leg of legs) byFixture.set(leg.fixtureId, [...(byFixture.get(leg.fixtureId) ?? []), leg]);
  const correlatedFixtures = [...byFixture.entries()].filter(([, ls]) => ls.length > 1).map(([id]) => id);

  // Combined odds: product of decimal odds, valid only for selections on different matches.
  let combinedOdds: number | null = null;
  let combinedOddsUnavailable: SlipAnalysis['combinedOddsUnavailable'];
  if (legs.length === 0 || legs.some((l) => l.odds === null || !isValidDecimalOdds(l.odds))) {
    combinedOddsUnavailable = 'missing_odds';
  } else if (correlatedFixtures.length > 0) {
    combinedOddsUnavailable = 'same_match';
    warnings.push({ key: 'slip.sameMatchOdds' });
  } else {
    combinedOdds = legs.reduce((s, l) => s * (l.odds as number), 1);
  }

  const staleLegs = legs.filter((l) => l.odds !== null && l.oddsQuotedAt !== null && nowMs - l.oddsQuotedAt > ODDS_MAX_AGE_MS);
  if (staleLegs.length > 0) warnings.push({ key: 'slip.staleOdds', params: { n: staleLegs.length } });
  const started = legs.filter((l) => l.kickoffUtc !== null && l.kickoffUtc <= nowMs);
  if (started.length > 0) warnings.push({ key: 'slip.started', params: { n: started.length } });

  // Combined probability: never a naive product for selections on the same match.
  let combinedProbability: number | null = 1;
  let probabilityUnavailable: SlipAnalysis['probabilityUnavailable'];
  let probabilityMethod: ProbabilityMethod = 'independent_matches';
  for (const [fixtureId, ls] of byFixture) {
    const selections = ls.map((l) => parseSelectionKey(l.selectionKey));
    if (selections.some((s) => s === null)) {
      combinedProbability = null;
      probabilityUnavailable = 'missing_probability';
      break;
    }
    if (ls.length === 1) {
      const leg = ls[0] as SlipLeg;
      if (!isBinaryMarket(selections[0] as Selection)) {
        combinedProbability = null;
        probabilityUnavailable = 'non_binary';
        break;
      }
      if (leg.probability === null) {
        combinedProbability = null;
        probabilityUnavailable = 'missing_probability';
        break;
      }
      combinedProbability = (combinedProbability as number) * leg.probability;
      continue;
    }
    const model = models.get(fixtureId);
    const joint = model ? jointProbabilitySameMatch(selections as Selection[], model.ft) : null;
    if (joint === null) {
      combinedProbability = null;
      probabilityUnavailable = 'correlation';
      warnings.push({ key: 'slip.correlationUnmodelled' });
      break;
    }
    probabilityMethod = 'joint_scoreline';
    combinedProbability = (combinedProbability as number) * joint;
  }
  if (legs.length === 0) combinedProbability = null;
  if (byFixture.size > 1 && combinedProbability !== null) warnings.push({ key: 'slip.independenceAssumed' });

  const validStake = Number.isFinite(stake) && stake > 0 ? stake : 0;
  const grossReturn = combinedOdds !== null && validStake > 0 ? validStake * combinedOdds : null;
  const netProfit = grossReturn !== null ? grossReturn - validStake : null;
  const expectedValue =
    combinedOdds !== null && combinedProbability !== null && staleLegs.length === 0 && started.length === 0
      ? combinedProbability * combinedOdds - 1
      : null;

  return {
    legs: legs.length,
    combinedOdds,
    combinedOddsUnavailable,
    grossReturn,
    netProfit,
    combinedProbability,
    probabilityUnavailable,
    probabilityMethod: combinedProbability !== null ? probabilityMethod : undefined,
    expectedValue,
    correlatedFixtures,
    warnings,
  };
}

export type SlipStatus = 'pending' | 'won' | 'lost' | 'void' | 'partial';

/** Settle an accumulator: void legs count at odds 1, half outcomes at half stake. */
export function settleSlip(legs: SlipLeg[], stake: number): { status: SlipStatus; returnAmount: number | null } {
  if (legs.some((l) => l.outcome === 'loss')) return { status: 'lost', returnAmount: 0 };
  if (legs.some((l) => !l.outcome)) return { status: 'pending', returnAmount: null };
  if (legs.some((l) => l.odds === null)) {
    const allPush = legs.every((l) => l.outcome === 'push');
    return { status: allPush ? 'void' : 'partial', returnAmount: null };
  }
  const multiplier = legs.reduce((m, l) => m * returnMultiplier(l.outcome as Outcome, l.odds as number), 1);
  const status: SlipStatus = legs.every((l) => l.outcome === 'push')
    ? 'void'
    : legs.every((l) => l.outcome === 'win' || l.outcome === 'push')
      ? 'won'
      : 'partial';
  return { status, returnAmount: stake * multiplier };
}
