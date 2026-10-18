import type { Fixture, LeagueDataset } from '@/domain/types';
import { assessConfidence, assessDataQuality, type Confidence, type DataQuality } from './assessment';
import { VALIDATED_COMPETITIONS } from './validation';
import { expectedGoalsFor, type FallbackLevel, type FitOptions, type LeagueModel, type TeamRating } from './fit';
import { buildHalfTimeModel, type HalfTimeModel } from './halftime';
import { buildMarketBook, checkConsistency, type ConsistencyIssue, type MarketBook } from './markets';
import { buildScoreMatrix, type ScoreMatrix } from './scoreMatrix';

export const MODEL_NAME = 'Dixon-Coles (IPF, time-weighted)';
export const MODEL_SEMVER = '1.0.0';

export function modelVersion(opts: Pick<FitOptions, 'halfLifeDays' | 'priorMatches' | 'totalShrink'>): string {
  return `dc-${MODEL_SEMVER}+hl${opts.halfLifeDays}.k${opts.priorMatches}.t${opts.totalShrink}`;
}

export interface MatchPrediction {
  fixtureId: string;
  competition: string;
  modelVersion: string;
  createdAt: number;
  /** Model trained on results strictly before this date. */
  fitAsOf: string;
  /** Latest result present in the source when the prediction was made. */
  dataAsOf: string | null;
  sourceFetchedAt: number;
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  homeAdvantage: number;
  ft: ScoreMatrix;
  half: HalfTimeModel | null;
  book: MarketBook;
  confidence: Confidence;
  quality: DataQuality;
  fallback: FallbackLevel;
  ratings: { home?: TeamRating; away?: TeamRating };
  defenceLevel: number;
  leagueAverages: { home: number; away: number; drawRate: number };
  issues: ConsistencyIssue[];
}

export interface PredictInput {
  fixture: Fixture;
  dataset: LeagueDataset;
  model: LeagueModel;
  nowMs: number;
  /** Defaults to whether the competition is covered by the shipped backtest. */
  validated?: boolean;
  servedFromStaleCache?: boolean;
}

function pendingFor(dataset: LeagueDataset, teams: string[], before: string): number {
  return dataset.pendingPastFixtures.filter((p) => p.date < before && (teams.includes(p.home) || teams.includes(p.away))).length;
}

function halfTimeCoverage(dataset: LeagueDataset, teams: string[], before: string): number {
  const relevant = dataset.matches.filter((m) => m.date < before && (teams.includes(m.home) || teams.includes(m.away)));
  if (relevant.length === 0) return 0;
  return relevant.filter((m) => m.ht).length / relevant.length;
}

export function predictMatch(input: PredictInput): MatchPrediction {
  const { fixture, dataset, model, nowMs } = input;
  const eg = expectedGoalsFor(model, fixture.home.key, fixture.away.key);
  const ft = buildScoreMatrix(eg.lambdaHome, eg.lambdaAway, model.rho);
  const half = model.halfTime && eg.fallback !== 'global_default' ? buildHalfTimeModel(ft, model.halfTime) : null;
  const book = buildMarketBook(ft, half);
  const teams = [fixture.home.key, fixture.away.key];
  const pending = pendingFor(dataset, teams, fixture.sourceDate);
  const home = model.ratings[fixture.home.key];
  const away = model.ratings[fixture.away.key];

  return {
    fixtureId: fixture.id,
    competition: fixture.competition,
    modelVersion: modelVersion(model.options),
    createdAt: nowMs,
    fitAsOf: model.asOf,
    dataAsOf: dataset.latestResultDate,
    sourceFetchedAt: dataset.fetchedAt,
    lambdaHome: eg.lambdaHome,
    lambdaAway: eg.lambdaAway,
    rho: ft.rho,
    homeAdvantage: model.homeAdvantage,
    ft,
    half,
    book,
    confidence: assessConfidence({
      model,
      home,
      away,
      fallback: eg.fallback === 'none' ? model.fallback : eg.fallback,
      matchDate: fixture.sourceDate,
      validated: input.validated ?? VALIDATED_COMPETITIONS.has(fixture.competition),
      pendingResults: pending,
    }),
    quality: assessDataQuality({
      fixture,
      dataset,
      nowMs,
      pendingResults: pending,
      halfTimeCoverage: halfTimeCoverage(dataset, teams, fixture.sourceDate),
      servedFromStaleCache: input.servedFromStaleCache ?? false,
    }),
    fallback: eg.fallback === 'none' ? model.fallback : eg.fallback,
    ratings: { home, away },
    defenceLevel: model.defenceLevel,
    leagueAverages: { home: model.avgHomeGoals, away: model.avgAwayGoals, drawRate: model.drawRate },
    issues: checkConsistency(ft, book),
  };
}
