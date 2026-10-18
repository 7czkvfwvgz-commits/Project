import { returnMultiplier, type Outcome } from './settlement';

export interface BinaryPrediction {
  p: number;
  /** 1 if the event happened. */
  y: 0 | 1;
}

const EPS = 1e-15;
const clampP = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));

export function brierScore(preds: BinaryPrediction[]): number {
  if (preds.length === 0) return NaN;
  return preds.reduce((s, { p, y }) => s + (p - y) ** 2, 0) / preds.length;
}

export function logLoss(preds: BinaryPrediction[]): number {
  if (preds.length === 0) return NaN;
  return -preds.reduce((s, { p, y }) => s + (y === 1 ? Math.log(clampP(p)) : Math.log(1 - clampP(p))), 0) / preds.length;
}

/** Hit rate: share of predictions whose event happened. */
export function hitRate(preds: BinaryPrediction[]): number {
  if (preds.length === 0) return NaN;
  return preds.filter((x) => x.y === 1).length / preds.length;
}

/** Multi-class Brier: mean over predictions of Σ_k (p_k − y_k)². */
export function multiclassBrier(probs: number[][], outcomes: number[]): number {
  if (probs.length === 0) return NaN;
  return (
    probs.reduce((s, row, i) => s + row.reduce((t, p, k) => t + (p - (outcomes[i] === k ? 1 : 0)) ** 2, 0), 0) / probs.length
  );
}

export function multiclassLogLoss(probs: number[][], outcomes: number[]): number {
  if (probs.length === 0) return NaN;
  return -probs.reduce((s, row, i) => s + Math.log(clampP(row[outcomes[i] as number] ?? 0)), 0) / probs.length;
}

/** Ranked probability score for ordered outcomes (home, draw, away). Lower is better. */
export function rankedProbabilityScore(probs: number[][], outcomes: number[]): number {
  if (probs.length === 0) return NaN;
  let total = 0;
  probs.forEach((row, i) => {
    let cumP = 0;
    let cumY = 0;
    let s = 0;
    for (let k = 0; k < row.length - 1; k++) {
      cumP += row[k] as number;
      cumY += outcomes[i] === k ? 1 : 0;
      s += (cumP - cumY) ** 2;
    }
    total += s / (row.length - 1);
  });
  return total / probs.length;
}

export function argmaxAccuracy(probs: number[][], outcomes: number[]): number {
  if (probs.length === 0) return NaN;
  const correct = probs.filter((row, i) => row.indexOf(Math.max(...row)) === outcomes[i]).length;
  return correct / probs.length;
}

/** Wilson score interval for a binomial proportion. */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const phat = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (phat + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  meanPredicted: number;
  observed: number;
  ciLow: number;
  ciHigh: number;
}

export function calibrationBins(preds: BinaryPrediction[], bins = 10): CalibrationBin[] {
  const out: CalibrationBin[] = [];
  for (let b = 0; b < bins; b++) {
    const lower = b / bins;
    const upper = (b + 1) / bins;
    const inBin = preds.filter(({ p }) => p >= lower && (b === bins - 1 ? p <= upper : p < upper));
    const hits = inBin.filter((x) => x.y === 1).length;
    const [ciLow, ciHigh] = wilsonInterval(hits, inBin.length);
    out.push({
      lower,
      upper,
      count: inBin.length,
      meanPredicted: inBin.length ? inBin.reduce((s, x) => s + x.p, 0) / inBin.length : NaN,
      observed: inBin.length ? hits / inBin.length : NaN,
      ciLow,
      ciHigh,
    });
  }
  return out;
}

/** Count-weighted mean |predicted − observed| across bins. */
export function expectedCalibrationError(bins: CalibrationBin[]): number {
  const n = bins.reduce((s, b) => s + b.count, 0);
  if (n === 0) return NaN;
  return bins.reduce((s, b) => (b.count ? s + (b.count / n) * Math.abs(b.meanPredicted - b.observed) : s), 0);
}

export interface ProfitAndLoss {
  bets: number;
  staked: number;
  returned: number;
  profit: number;
  roi: number;
}

/** Level-stakes (1 unit) hypothetical P&L for settled selections with recorded odds. */
export function profitAndLoss(rows: { outcome: Outcome; odds: number }[]): ProfitAndLoss {
  const staked = rows.length;
  const returned = rows.reduce((s, r) => s + returnMultiplier(r.outcome, r.odds), 0);
  return { bets: rows.length, staked, returned, profit: returned - staked, roi: staked ? (returned - staked) / staked : NaN };
}

/** Below this many settled predictions, metrics are shown with a small-sample warning. */
export const SMALL_SAMPLE = 100;
