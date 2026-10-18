import type { Fixture, LeagueDataset } from '@/domain/types';
import type { Msg } from '@/i18n/types';
import { diffDays, todayKey, type DateKey } from '@/time/tz';
import type { FallbackLevel, LeagueModel, TeamRating } from './fit';
import type { SelectionScope } from './settlement';

/**
 * Model confidence and data quality are deliberately separate concepts:
 * - confidence: how far the probability estimate itself can be trusted
 *   (sample size, newcomers, early season, fallback, validated scope);
 * - data quality: how complete and current the inputs are.
 * Neither says anything about how likely a selection is to win, or about value.
 */
export type Level = 'low' | 'medium' | 'high';
export type Grade = 'A' | 'B' | 'C' | 'D';

export interface Confidence {
  score: number;
  level: Level;
  reasons: Msg[];
}

export interface DataQuality {
  score: number;
  grade: Grade;
  reasons: Msg[];
}

const levelFor = (score: number): Level => (score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low');
const gradeFor = (score: number): Grade => (score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D');
const clampScore = (s: number) => Math.round(Math.max(0, Math.min(100, s)));

export interface ConfidenceInput {
  model: LeagueModel;
  home?: TeamRating;
  away?: TeamRating;
  fallback: FallbackLevel;
  matchDate: DateKey;
  /** Competitions covered by the published walk-forward backtest. */
  validated: boolean;
  pendingResults: number;
}

export function assessConfidence(input: ConfidenceInput): Confidence {
  const reasons: Msg[] = [];
  let score = 100;
  let cap = 100;
  const { home, away } = input;

  if (input.fallback === 'global_default') {
    cap = 15;
    reasons.push({ key: 'conf.globalFallback' });
  } else if (input.fallback === 'league_average') {
    cap = 30;
    reasons.push({ key: 'conf.teamFallback' });
  }

  const ess = Math.min(home?.effectiveMatches ?? 0, away?.effectiveMatches ?? 0);
  if (ess < 6) {
    score -= 35;
    reasons.push({ key: 'conf.smallSample', params: { n: ess.toFixed(1) } });
  } else if (ess < 12) {
    score -= 20;
    reasons.push({ key: 'conf.smallSample', params: { n: ess.toFixed(1) } });
  } else if (ess < 20) {
    score -= 10;
    reasons.push({ key: 'conf.moderateSample', params: { n: ess.toFixed(1) } });
  }

  const newcomers = [home, away].filter((r) => r?.newcomer);
  if (newcomers.length > 0) {
    score -= 15;
    reasons.push({ key: 'conf.newcomer', params: { n: newcomers.length } });
  }

  const seasonMin = Math.min(home?.seasonMatches ?? 0, away?.seasonMatches ?? 0);
  if (seasonMin < 3) {
    score -= 15;
    reasons.push({ key: 'conf.earlySeason', params: { n: seasonMin } });
  } else if (seasonMin < 6) {
    score -= 8;
    reasons.push({ key: 'conf.earlySeason', params: { n: seasonMin } });
  }

  const lastDates = [home?.lastMatchDate, away?.lastMatchDate];
  const gaps = lastDates.map((d) => (d ? diffDays(d, input.matchDate) : Infinity));
  const worstGap = Math.max(...gaps);
  if (worstGap > 45) {
    score -= 25;
    reasons.push({ key: 'conf.staleTeamData', params: { days: Number.isFinite(worstGap) ? worstGap : '—' } });
  } else if (worstGap > 21) {
    score -= 15;
    reasons.push({ key: 'conf.staleTeamData', params: { days: worstGap } });
  }

  if (input.pendingResults >= 2) {
    score -= 10;
    reasons.push({ key: 'conf.missingResults', params: { n: input.pendingResults } });
  }

  if (!input.model.rhoEstimated && input.fallback === 'none') {
    score -= 5;
    reasons.push({ key: 'conf.noLowScoreAdjustment' });
  }

  if (!input.validated) {
    score -= 10;
    reasons.push({ key: 'conf.notValidated' });
  }

  const final = clampScore(Math.min(score, cap));
  return { score: final, level: levelFor(final), reasons };
}

/** Half-time markets rest on extra assumptions, so they inherit lower confidence. */
export function confidenceForScope(base: Confidence, scope: SelectionScope): Confidence {
  if (scope === 'ft') return base;
  const penalty = scope === 'ht' ? 15 : 25;
  const score = clampScore(base.score - penalty);
  return {
    score,
    level: levelFor(score),
    reasons: [...base.reasons, { key: scope === 'ht' ? 'conf.halfTimeAssumption' : 'conf.htftAssumption' }],
  };
}

export interface QualityInput {
  fixture: Fixture;
  dataset: LeagueDataset;
  nowMs: number;
  /** Results of either team that are missing from the source although the match date has passed. */
  pendingResults: number;
  /** Share of each team's matches that carry a half-time score. */
  halfTimeCoverage: number;
  servedFromStaleCache: boolean;
}

export function assessDataQuality(input: QualityInput): DataQuality {
  const reasons: Msg[] = [];
  if (input.fixture.isDemo || input.dataset.isDemo) {
    return { score: 0, grade: 'D', reasons: [{ key: 'quality.demo' }] };
  }
  let score = 100;

  // No free source we use publishes xG, shots, lineups or injuries.
  score -= 15;
  reasons.push({ key: 'quality.resultsOnly' });

  if (input.fixture.kickoffUtc === null) {
    score -= 10;
    reasons.push({ key: 'quality.noKickoffTime' });
  }

  if (input.pendingResults > 0) {
    score -= Math.min(25, 5 * input.pendingResults);
    reasons.push({ key: 'quality.pendingResults', params: { n: input.pendingResults } });
  }

  const latest = input.dataset.latestResultDate;
  const sourceAge = latest ? diffDays(latest, todayKey('UTC', input.nowMs)) : Infinity;
  if (sourceAge > 21) {
    score -= 20;
    reasons.push({ key: 'quality.sourceLag', params: { date: latest ?? '—' } });
  } else if (sourceAge > 7) {
    score -= 10;
    reasons.push({ key: 'quality.sourceLag', params: { date: latest ?? '—' } });
  }

  if (input.halfTimeCoverage < 0.8) {
    score -= 5;
    reasons.push({ key: 'quality.partialHalfTime', params: { pct: Math.round(input.halfTimeCoverage * 100) } });
  }

  if (input.servedFromStaleCache) {
    score -= 10;
    reasons.push({ key: 'quality.staleCache' });
  }

  const final = clampScore(score);
  return { score: final, grade: gradeFor(final), reasons };
}
