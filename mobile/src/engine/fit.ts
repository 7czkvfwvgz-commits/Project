import { previousSeason } from '@/config/competitions';
import type { HistoricalMatch, LeagueDataset } from '@/domain/types';
import { diffDays, type DateKey } from '@/time/tz';
import { dcTau, rhoBounds } from './scoreMatrix';

/**
 * Dixon-Coles goal model.
 *
 *   λ_home = γ · attack_home · defence_away
 *   λ_away =     attack_away · defence_home
 *
 * Attack/defence/home-advantage are maximum-likelihood estimates of the
 * time-weighted Poisson model, found by iterative proportional fitting, with
 * each team shrunk towards a prior by `priorMatches` pseudo-matches. The
 * Dixon-Coles ρ is then estimated by maximising the weighted τ-likelihood with
 * the other parameters held fixed (two-stage estimation).
 */

export interface FitOptions {
  /** Weight halves every `halfLifeDays` days before the prediction date. */
  halfLifeDays: number;
  /** Shrinkage strength towards each team's prior, in pseudo-matches. */
  priorMatches: number;
  /** Below this many training matches ρ is fixed at 0 (plain Poisson). */
  minMatchesForRho: number;
  /** Below this many training matches the league falls back to global defaults. */
  minMatchesForModel: number;
  maxAgeDays: number;
  maxIterations: number;
  tolerance: number;
}

/** Tuned on 2023-24 and 2024-25 walk-forward results; see scripts/backtest.ts. */
export const DEFAULT_FIT_OPTIONS: FitOptions = {
  halfLifeDays: 180,
  priorMatches: 4,
  minMatchesForRho: 150,
  minMatchesForModel: 40,
  maxAgeDays: 730,
  maxIterations: 300,
  tolerance: 1e-7,
};

/** Used only when a league has too little history: typical European top-flight rates. */
export const GLOBAL_DEFAULT_RATES = { home: 1.5, away: 1.2 };

export interface TeamRating {
  key: string;
  attack: number;
  /** Above 1 concedes more than an average team. */
  defence: number;
  /** Sum of time-decay weights of the team's training matches. */
  effectiveMatches: number;
  matches: number;
  seasonMatches: number;
  /** No previous-season matches in this league (promoted or new). */
  newcomer: boolean;
  prior: 'league_average' | 'relegated_teams';
  lastMatchDate: DateKey | null;
}

export type FallbackLevel = 'none' | 'league_average' | 'global_default';

export interface HalfTimeShares {
  homeShare: number;
  awayShare: number;
  sample: number;
}

export interface LeagueModel {
  competition: string;
  season: string;
  asOf: DateKey;
  homeAdvantage: number;
  rho: number;
  rhoEstimated: boolean;
  ratings: Record<string, TeamRating>;
  /** Mean defence factor; a team's defence ÷ this is its rate relative to the league average. */
  defenceLevel: number;
  trainingMatches: number;
  effectiveMatches: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  drawRate: number;
  halfTime: HalfTimeShares | null;
  fallback: FallbackLevel;
  options: FitOptions;
  latestTrainingDate: DateKey | null;
}

const MIN_HT_SAMPLE = 100;
const RATING_MIN = 0.05;
const RATING_MAX = 20;
const RHO_LIMIT = 0.3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Prepared {
  matches: HistoricalMatch[];
  weights: number[];
  home: number[];
  away: number[];
}

function prepare(train: HistoricalMatch[], asOf: DateKey, index: Map<string, number>, halfLifeDays: number): Prepared {
  return {
    matches: train,
    weights: train.map((m) => Math.pow(0.5, diffDays(m.date, asOf) / halfLifeDays)),
    home: train.map((m) => index.get(m.home) as number),
    away: train.map((m) => index.get(m.away) as number),
  };
}

const mean = (xs: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i] as number;
  return xs.length ? s / xs.length : 0;
};

function iterativeFit(
  data: Prepared,
  n: number,
  priorAttack: Float64Array,
  priorDefence: Float64Array,
  opts: FitOptions,
): { attack: Float64Array; defence: Float64Array; gamma: number } {
  const k = Math.max(opts.priorMatches, 0.25);
  let attack = new Float64Array(n).fill(1);
  let defence = new Float64Array(n).fill(1);
  let sumWH = 0;
  let sumWA = 0;
  data.matches.forEach((m, i) => {
    sumWH += (data.weights[i] as number) * m.ft.home;
    sumWA += (data.weights[i] as number) * m.ft.away;
  });
  let gamma = sumWA > 0 ? clamp(sumWH / sumWA, 0.8, 2) : 1.25;
  // Start defence at the league scoring level so the first sweep is well scaled.
  const totalW = data.weights.reduce((s, w) => s + w, 0) || 1;
  defence.fill(Math.max((sumWA / totalW) || 1, 0.3));

  const num = new Float64Array(n);
  const den = new Float64Array(n);
  for (let iter = 0; iter < opts.maxIterations; iter++) {
    const half = (1 + gamma) / 2;

    num.fill(0);
    den.fill(0);
    for (let i = 0; i < data.matches.length; i++) {
      const m = data.matches[i] as HistoricalMatch;
      const w = data.weights[i] as number;
      const h = data.home[i] as number;
      const a = data.away[i] as number;
      num[h] = (num[h] as number) + w * m.ft.home;
      den[h] = (den[h] as number) + w * gamma * (defence[a] as number);
      num[a] = (num[a] as number) + w * m.ft.away;
      den[a] = (den[a] as number) + w * (defence[h] as number);
    }
    const cA = mean(defence) * half;
    const nextAttack = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      nextAttack[t] = clamp(((num[t] as number) + k * (priorAttack[t] as number) * cA) / ((den[t] as number) + k * cA), RATING_MIN, RATING_MAX);
    }

    num.fill(0);
    den.fill(0);
    for (let i = 0; i < data.matches.length; i++) {
      const m = data.matches[i] as HistoricalMatch;
      const w = data.weights[i] as number;
      const h = data.home[i] as number;
      const a = data.away[i] as number;
      num[a] = (num[a] as number) + w * m.ft.home;
      den[a] = (den[a] as number) + w * gamma * (nextAttack[h] as number);
      num[h] = (num[h] as number) + w * m.ft.away;
      den[h] = (den[h] as number) + w * (nextAttack[a] as number);
    }
    const cD = mean(nextAttack) * half;
    // Defence priors are relative to the league's scoring level.
    const level = mean(defence);
    const nextDefence = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      nextDefence[t] = clamp(
        ((num[t] as number) + k * (priorDefence[t] as number) * level * cD) / ((den[t] as number) + k * cD),
        RATING_MIN,
        RATING_MAX,
      );
    }

    let gNum = 0;
    let gDen = 0;
    for (let i = 0; i < data.matches.length; i++) {
      const w = data.weights[i] as number;
      gNum += w * (data.matches[i] as HistoricalMatch).ft.home;
      gDen += w * (nextAttack[data.home[i] as number] as number) * (nextDefence[data.away[i] as number] as number);
    }
    const nextGamma = gDen > 0 ? clamp(gNum / gDen, 0.5, 3) : gamma;

    // Identify the scale: mean attack = 1.
    const s = mean(nextAttack) || 1;
    for (let t = 0; t < n; t++) {
      nextAttack[t] = (nextAttack[t] as number) / s;
      nextDefence[t] = (nextDefence[t] as number) * s;
    }

    let maxChange = Math.abs(nextGamma - gamma) / gamma;
    for (let t = 0; t < n; t++) {
      maxChange = Math.max(
        maxChange,
        Math.abs((nextAttack[t] as number) - (attack[t] as number)) / (attack[t] as number),
        Math.abs((nextDefence[t] as number) - (defence[t] as number)) / (defence[t] as number),
      );
    }
    attack = nextAttack;
    defence = nextDefence;
    gamma = nextGamma;
    if (maxChange < opts.tolerance) break;
  }
  return { attack, defence, gamma };
}

function estimateRho(data: Prepared, attack: Float64Array, defence: Float64Array, gamma: number): number {
  let lo = -RHO_LIMIT;
  let hi = RHO_LIMIT;
  const terms: { h: number; a: number; lh: number; la: number; w: number }[] = [];
  data.matches.forEach((m, i) => {
    const lh = gamma * (attack[data.home[i] as number] as number) * (defence[data.away[i] as number] as number);
    const la = (attack[data.away[i] as number] as number) * (defence[data.home[i] as number] as number);
    const [bl, bh] = rhoBounds(lh, la);
    lo = Math.max(lo, bl + 1e-6);
    hi = Math.min(hi, bh - 1e-6);
    if (m.ft.home <= 1 && m.ft.away <= 1) terms.push({ h: m.ft.home, a: m.ft.away, lh, la, w: data.weights[i] as number });
  });
  if (!(lo < hi) || terms.length === 0) return 0;
  const loglik = (rho: number) => terms.reduce((s, t) => s + t.w * Math.log(dcTau(t.h, t.a, t.lh, t.la, rho)), 0);
  // The τ log-likelihood is concave in ρ, so golden-section search finds the maximum.
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = loglik(c);
  let fd = loglik(d);
  for (let i = 0; i < 80 && b - a > 1e-6; i++) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = loglik(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = loglik(d);
    }
  }
  return (a + b) / 2;
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 1;
  return Math.exp(values.reduce((s, v) => s + Math.log(v), 0) / values.length);
}

export function fitLeagueModel(
  dataset: LeagueDataset,
  asOf: DateKey,
  season: string,
  options: Partial<FitOptions> = {},
): LeagueModel {
  const opts: FitOptions = { ...DEFAULT_FIT_OPTIONS, ...options };
  // Strictly before the prediction date: no same-day or future information.
  const train = dataset.matches.filter((m) => m.date < asOf && diffDays(m.date, asOf) <= opts.maxAgeDays);
  const prevTeams = new Set(dataset.teamsBySeason[previousSeason(season)] ?? []);
  const currentTeams = dataset.teamsBySeason[season] ?? [];

  const teamSet = new Set<string>(currentTeams);
  for (const m of train) {
    teamSet.add(m.home);
    teamSet.add(m.away);
  }
  const teams = [...teamSet].sort();
  const index = new Map(teams.map((t, i) => [t, i]));
  const data = prepare(train, asOf, index, opts.halfLifeDays);
  const totalWeight = data.weights.reduce((s, w) => s + w, 0);

  let wHome = 0;
  let wAway = 0;
  let wDraw = 0;
  let htHome = 0;
  let htAway = 0;
  let ftHomeWithHt = 0;
  let ftAwayWithHt = 0;
  let htSample = 0;
  train.forEach((m, i) => {
    const w = data.weights[i] as number;
    wHome += w * m.ft.home;
    wAway += w * m.ft.away;
    if (m.ft.home === m.ft.away) wDraw += w;
    if (m.ht) {
      htSample++;
      htHome += w * m.ht.home;
      htAway += w * m.ht.away;
      ftHomeWithHt += w * m.ft.home;
      ftAwayWithHt += w * m.ft.away;
    }
  });

  const stats = (key: string) => {
    let eff = 0;
    let count = 0;
    let seasonCount = 0;
    let last: DateKey | null = null;
    train.forEach((m, i) => {
      if (m.home !== key && m.away !== key) return;
      eff += data.weights[i] as number;
      count++;
      if (m.season === season) seasonCount++;
      if (!last || m.date > last) last = m.date;
    });
    return { eff, count, seasonCount, last };
  };

  const hasPrevSeason = prevTeams.size > 0;
  const isNewcomer = (key: string) => hasPrevSeason && !prevTeams.has(key);

  const base = {
    competition: dataset.competition,
    season,
    asOf,
    trainingMatches: train.length,
    effectiveMatches: totalWeight,
    options: opts,
    latestTrainingDate: train.reduce<DateKey | null>((acc, m) => (!acc || m.date > acc ? m.date : acc), null),
  };

  if (train.length < opts.minMatchesForModel || totalWeight <= 0) {
    const ratings: Record<string, TeamRating> = {};
    for (const key of teams) {
      const s = stats(key);
      ratings[key] = {
        key,
        attack: 1,
        defence: 1,
        effectiveMatches: s.eff,
        matches: s.count,
        seasonMatches: s.seasonCount,
        newcomer: isNewcomer(key),
        prior: 'league_average',
        lastMatchDate: s.last,
      };
    }
    return {
      ...base,
      homeAdvantage: GLOBAL_DEFAULT_RATES.home / GLOBAL_DEFAULT_RATES.away,
      rho: 0,
      rhoEstimated: false,
      ratings,
      defenceLevel: 1,
      avgHomeGoals: GLOBAL_DEFAULT_RATES.home,
      avgAwayGoals: GLOBAL_DEFAULT_RATES.away,
      drawRate: totalWeight > 0 ? wDraw / totalWeight : 0.26,
      halfTime: null,
      fallback: 'global_default',
    };
  }

  const n = teams.length;
  const ones = () => new Float64Array(n).fill(1);
  // Pass 1: every team shrinks towards the league average.
  const first = iterativeFit(data, n, ones(), ones(), opts);

  // Pass 2: promoted/new teams shrink towards the average of the teams they replaced.
  const relegated = [...prevTeams].filter((t) => !currentTeams.includes(t) && index.has(t));
  const newcomers = teams.filter(isNewcomer);
  const priorAttack = ones();
  const priorDefence = ones();
  let usedRelegatedPrior = false;
  if (relegated.length > 0 && newcomers.length > 0) {
    const level = mean(first.defence);
    const relAttack = geometricMean(relegated.map((t) => first.attack[index.get(t) as number] as number));
    const relDefence = geometricMean(relegated.map((t) => (first.defence[index.get(t) as number] as number) / level));
    for (const t of newcomers) {
      const i = index.get(t) as number;
      priorAttack[i] = relAttack;
      priorDefence[i] = relDefence;
    }
    usedRelegatedPrior = true;
  }
  const fit = usedRelegatedPrior ? iterativeFit(data, n, priorAttack, priorDefence, opts) : first;

  const rhoEstimated = train.length >= opts.minMatchesForRho;
  const rho = rhoEstimated ? estimateRho(data, fit.attack, fit.defence, fit.gamma) : 0;

  const ratings: Record<string, TeamRating> = {};
  teams.forEach((key, i) => {
    const s = stats(key);
    ratings[key] = {
      key,
      attack: fit.attack[i] as number,
      defence: fit.defence[i] as number,
      effectiveMatches: s.eff,
      matches: s.count,
      seasonMatches: s.seasonCount,
      newcomer: isNewcomer(key),
      prior: usedRelegatedPrior && isNewcomer(key) ? 'relegated_teams' : 'league_average',
      lastMatchDate: s.last,
    };
  });

  return {
    ...base,
    homeAdvantage: fit.gamma,
    rho,
    rhoEstimated,
    ratings,
    defenceLevel: mean(fit.defence),
    avgHomeGoals: wHome / totalWeight,
    avgAwayGoals: wAway / totalWeight,
    drawRate: wDraw / totalWeight,
    halfTime:
      htSample >= MIN_HT_SAMPLE && ftHomeWithHt > 0 && ftAwayWithHt > 0
        ? { homeShare: htHome / ftHomeWithHt, awayShare: htAway / ftAwayWithHt, sample: htSample }
        : null,
    fallback: 'none',
  };
}

export interface ExpectedGoals {
  lambdaHome: number;
  lambdaAway: number;
  fallback: FallbackLevel;
  missingTeams: string[];
}

const LAMBDA_MIN = 0.05;
const LAMBDA_MAX = 6;

export function expectedGoalsFor(model: LeagueModel, homeKey: string, awayKey: string): ExpectedGoals {
  if (model.fallback === 'global_default') {
    return { lambdaHome: GLOBAL_DEFAULT_RATES.home, lambdaAway: GLOBAL_DEFAULT_RATES.away, fallback: 'global_default', missingTeams: [] };
  }
  const avg = { attack: 1, defence: model.defenceLevel };
  const h = model.ratings[homeKey] ?? avg;
  const a = model.ratings[awayKey] ?? avg;
  const missingTeams = [homeKey, awayKey].filter((k) => !model.ratings[k]);
  return {
    lambdaHome: clamp(model.homeAdvantage * h.attack * a.defence, LAMBDA_MIN, LAMBDA_MAX),
    lambdaAway: clamp(a.attack * h.defence, LAMBDA_MIN, LAMBDA_MAX),
    fallback: missingTeams.length > 0 ? 'league_average' : 'none',
    missingTeams,
  };
}
