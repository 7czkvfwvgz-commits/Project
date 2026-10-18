import { poissonQuantileForTail, poissonVector } from './poisson';

/**
 * Joint distribution of (home goals, away goals). `p[h][a]` sums to 1.
 * Built from independent Poisson marginals with the Dixon-Coles (1997)
 * low-score correction τ applied to 0-0, 0-1, 1-0 and 1-1.
 */
export interface ScoreMatrix {
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  maxGoals: number;
  p: number[][];
}

/** Probability mass dropped by truncating the grid; renormalised afterwards. */
const TAIL_TOLERANCE = 1e-10;
const MIN_GRID = 10;

export function dcTau(h: number, a: number, lambdaHome: number, lambdaAway: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (h === 0 && a === 1) return 1 + lambdaHome * rho;
  if (h === 1 && a === 0) return 1 + lambdaAway * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

/** Range of ρ for which every τ stays non-negative. */
export function rhoBounds(lambdaHome: number, lambdaAway: number): [number, number] {
  const lower = Math.max(-1 / Math.max(lambdaHome, 1e-9), -1 / Math.max(lambdaAway, 1e-9));
  const upper = Math.min(1 / Math.max(lambdaHome * lambdaAway, 1e-9), 1);
  return [lower, upper];
}

export function clampRho(rho: number, lambdaHome: number, lambdaAway: number): number {
  const [lo, hi] = rhoBounds(lambdaHome, lambdaAway);
  return Math.min(hi, Math.max(lo, rho));
}

export function buildScoreMatrix(lambdaHome: number, lambdaAway: number, rho = 0): ScoreMatrix {
  if (!(lambdaHome > 0) || !(lambdaAway > 0) || !Number.isFinite(lambdaHome) || !Number.isFinite(lambdaAway)) {
    throw new RangeError(`Expected goals must be positive and finite (got ${lambdaHome}, ${lambdaAway})`);
  }
  const r = clampRho(rho, lambdaHome, lambdaAway);
  const maxGoals = Math.max(
    MIN_GRID,
    poissonQuantileForTail(lambdaHome, TAIL_TOLERANCE),
    poissonQuantileForTail(lambdaAway, TAIL_TOLERANCE),
  );
  const ph = poissonVector(lambdaHome, maxGoals);
  const pa = poissonVector(lambdaAway, maxGoals);
  const p: number[][] = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a++) {
      const v = (ph[h] as number) * (pa[a] as number) * dcTau(h, a, lambdaHome, lambdaAway, r);
      row.push(v);
      total += v;
    }
    p.push(row);
  }
  for (const row of p) for (let a = 0; a < row.length; a++) row[a] = (row[a] as number) / total;
  return { lambdaHome, lambdaAway, rho: r, maxGoals, p };
}

export function cell(m: ScoreMatrix, h: number, a: number): number {
  return m.p[h]?.[a] ?? 0;
}

export function matrixSum(m: ScoreMatrix): number {
  let s = 0;
  for (const row of m.p) for (const v of row) s += v;
  return s;
}

export function probabilityWhere(m: ScoreMatrix, predicate: (h: number, a: number) => boolean): number {
  let s = 0;
  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) if (predicate(h, a)) s += cell(m, h, a);
  }
  return s;
}

export function marginals(m: ScoreMatrix): { home: number[]; away: number[] } {
  const home = new Array<number>(m.maxGoals + 1).fill(0);
  const away = new Array<number>(m.maxGoals + 1).fill(0);
  for (let h = 0; h <= m.maxGoals; h++) {
    for (let a = 0; a <= m.maxGoals; a++) {
      home[h] = (home[h] as number) + cell(m, h, a);
      away[a] = (away[a] as number) + cell(m, h, a);
    }
  }
  return { home, away };
}

export function expectedGoals(m: ScoreMatrix): { home: number; away: number } {
  const { home, away } = marginals(m);
  return {
    home: home.reduce((s, p, k) => s + p * k, 0),
    away: away.reduce((s, p, k) => s + p * k, 0),
  };
}

export function topScorelines(m: ScoreMatrix, n: number): { home: number; away: number; p: number }[] {
  const all: { home: number; away: number; p: number }[] = [];
  for (let h = 0; h <= m.maxGoals; h++) for (let a = 0; a <= m.maxGoals; a++) all.push({ home: h, away: a, p: cell(m, h, a) });
  return all.sort((x, y) => y.p - x.p).slice(0, n);
}
