const LOG_FACTORIAL: number[] = [0];

export function logFactorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`logFactorial needs a non-negative integer, got ${n}`);
  for (let i = LOG_FACTORIAL.length; i <= n; i++) {
    LOG_FACTORIAL[i] = (LOG_FACTORIAL[i - 1] as number) + Math.log(i);
  }
  return LOG_FACTORIAL[n] as number;
}

/** P(X = k) for X ~ Poisson(lambda). */
export function poissonPmf(k: number, lambda: number): number {
  if (!(lambda >= 0) || !Number.isFinite(lambda)) throw new RangeError(`Invalid Poisson rate ${lambda}`);
  if (!Number.isInteger(k) || k < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

/** P(X ≤ k). */
export function poissonCdf(k: number, lambda: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, lambda);
  return Math.min(1, sum);
}

/** Probabilities for 0..maxGoals goals. */
export function poissonVector(lambda: number, maxGoals: number): number[] {
  const out: number[] = [];
  for (let k = 0; k <= maxGoals; k++) out.push(poissonPmf(k, lambda));
  return out;
}

/** Smallest n such that P(X > n) < tail. */
export function poissonQuantileForTail(lambda: number, tail: number): number {
  let cumulative = 0;
  for (let k = 0; k < 200; k++) {
    cumulative += poissonPmf(k, lambda);
    if (1 - cumulative < tail) return k;
  }
  return 200;
}
