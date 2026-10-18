import backtest from '@/data/backtest.json';
import type { MarketGroup } from './markets';

/**
 * Out-of-sample skill per market group, from the walk-forward backtest that
 * ships with the app (src/data/backtest.json). Skill is the relative log-loss
 * improvement over a baseline that predicts last season's league frequencies.
 */
export type SkillLevel = 'clear' | 'weak' | 'none' | 'untested';

export interface MarketSkill {
  level: SkillLevel;
  /** Relative log-loss improvement over the baseline (0.05 = 5% better). */
  improvement: number | null;
  matches: number;
}

export const BACKTEST = backtest;

export const VALIDATED_COMPETITIONS: ReadonlySet<string> = new Set(backtest.leagues);

function skillFrom(model: number | undefined, baseline: number | undefined, matches: number): MarketSkill {
  if (model === undefined || baseline === undefined || !(baseline > 0)) return { level: 'untested', improvement: null, matches };
  const improvement = 1 - model / baseline;
  return { level: improvement >= 0.02 ? 'clear' : improvement > 0 ? 'weak' : 'none', improvement, matches };
}

export function marketSkill(group: MarketGroup): MarketSkill {
  const t = backtest.test;
  const ht = t.halfTime1x2 as { matches: number; logLoss: number; logLossBaseline?: number } | null;
  switch (group) {
    case 'result':
      return skillFrom(t.logLoss1x2, t.logLoss1x2Baseline, t.matches);
    case 'goals':
      return skillFrom(t.over25.logLoss, t.over25.logLossBaseline, t.matches);
    case 'btts':
      return skillFrom(t.btts.logLoss, t.btts.logLossBaseline, t.matches);
    case 'halftime':
      return ht ? skillFrom(ht.logLoss, ht.logLossBaseline, ht.matches) : { level: 'untested', improvement: null, matches: 0 };
    default:
      return { level: 'untested', improvement: null, matches: 0 };
  }
}
