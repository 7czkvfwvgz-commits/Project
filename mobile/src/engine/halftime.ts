import type { HalfTimeShares } from './fit';
import { poissonQuantileForTail, poissonVector } from './poisson';
import { buildScoreMatrix, cell, type ScoreMatrix } from './scoreMatrix';
import { threeWay, type ThreeWay } from './settlement';

/**
 * Half-time model. Each team's goals are split into two Poisson halves using
 * the league's observed first-half share of goals:
 *   λ1 = share · λ,  λ2 = (1 − share) · λ.
 * The first-half matrix is plain Poisson (no low-score correction is
 * estimated for halves). Half-time/full-time joint probabilities assume the
 * halves are independent given λ, then are rescaled so the full-time marginal
 * equals the main Dixon-Coles model exactly.
 */
export interface HalfTimeModel {
  ht: ScoreMatrix;
  /** htft[htResult][ftResult] */
  htft: Record<ThreeWay, Record<ThreeWay, number>>;
  shares: HalfTimeShares;
}

const RESULTS: ThreeWay[] = ['H', 'D', 'A'];

function zeroTable(): Record<ThreeWay, Record<ThreeWay, number>> {
  return { H: { H: 0, D: 0, A: 0 }, D: { H: 0, D: 0, A: 0 }, A: { H: 0, D: 0, A: 0 } };
}

/** Distribution of (home − away) goals in the second half. */
function differenceDistribution(lambdaHome: number, lambdaAway: number): Map<number, number> {
  const max = Math.max(10, poissonQuantileForTail(lambdaHome, 1e-10), poissonQuantileForTail(lambdaAway, 1e-10));
  const ph = poissonVector(lambdaHome, max);
  const pa = poissonVector(lambdaAway, max);
  const out = new Map<number, number>();
  for (let h = 0; h <= max; h++) {
    for (let a = 0; a <= max; a++) {
      const d = h - a;
      out.set(d, (out.get(d) ?? 0) + (ph[h] as number) * (pa[a] as number));
    }
  }
  return out;
}

export function buildHalfTimeModel(ft: ScoreMatrix, shares: HalfTimeShares): HalfTimeModel {
  const h1 = Math.max(ft.lambdaHome * shares.homeShare, 0.01);
  const a1 = Math.max(ft.lambdaAway * shares.awayShare, 0.01);
  const h2 = Math.max(ft.lambdaHome * (1 - shares.homeShare), 0.01);
  const a2 = Math.max(ft.lambdaAway * (1 - shares.awayShare), 0.01);
  const ht = buildScoreMatrix(h1, a1, 0);
  const second = differenceDistribution(h2, a2);

  const independent = zeroTable();
  for (let h = 0; h <= ht.maxGoals; h++) {
    for (let a = 0; a <= ht.maxGoals; a++) {
      const p1 = cell(ht, h, a);
      if (p1 === 0) continue;
      const htRes = threeWay(h, a);
      const firstDiff = h - a;
      for (const [d, p2] of second) {
        const ftRes = threeWay(firstDiff + d, 0);
        independent[htRes][ftRes] += p1 * p2;
      }
    }
  }

  const ftMarginal: Record<ThreeWay, number> = { H: 0, D: 0, A: 0 };
  for (let h = 0; h <= ft.maxGoals; h++) for (let a = 0; a <= ft.maxGoals; a++) ftMarginal[threeWay(h, a)] += cell(ft, h, a);

  const htft = zeroTable();
  for (const f of RESULTS) {
    const column = RESULTS.reduce((s, r) => s + independent[r][f], 0);
    for (const r of RESULTS) htft[r][f] = column > 0 ? (ftMarginal[f] * independent[r][f]) / column : 0;
  }
  return { ht, htft, shares };
}
