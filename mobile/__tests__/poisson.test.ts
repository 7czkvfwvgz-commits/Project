import { logFactorial, poissonCdf, poissonPmf, poissonQuantileForTail, poissonVector } from '@/engine/poisson';
import { buildScoreMatrix, cell, dcTau, expectedGoals, matrixSum, probabilityWhere, rhoBounds, topScorelines } from '@/engine/scoreMatrix';

describe('Poisson', () => {
  it('matches the closed form', () => {
    const lambda = 1.7;
    for (let k = 0; k <= 8; k++) {
      let fact = 1;
      for (let i = 2; i <= k; i++) fact *= i;
      expect(poissonPmf(k, lambda)).toBeCloseTo((Math.exp(-lambda) * lambda ** k) / fact, 12);
    }
  });

  it('sums to one and has mean λ', () => {
    const v = poissonVector(2.4, 40);
    expect(v.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
    expect(v.reduce((s, p, k) => s + p * k, 0)).toBeCloseTo(2.4, 10);
  });

  it('handles λ = 0 and invalid input', () => {
    expect(poissonPmf(0, 0)).toBe(1);
    expect(poissonPmf(2, 0)).toBe(0);
    expect(poissonPmf(-1, 1)).toBe(0);
    expect(() => poissonPmf(1, -1)).toThrow(RangeError);
    expect(() => poissonPmf(1, Number.NaN)).toThrow(RangeError);
    expect(() => logFactorial(-1)).toThrow(RangeError);
  });

  it('computes CDF and tail quantiles', () => {
    expect(poissonCdf(0, 1.3)).toBeCloseTo(Math.exp(-1.3), 12);
    const n = poissonQuantileForTail(3, 1e-10);
    expect(1 - poissonCdf(n, 3)).toBeLessThan(1e-10);
    expect(1 - poissonCdf(n - 1, 3)).toBeGreaterThanOrEqual(1e-10);
  });
});

describe('scoreline distribution', () => {
  it('sums to one, with and without the Dixon-Coles correction', () => {
    for (const rho of [0, -0.1, 0.08]) {
      const m = buildScoreMatrix(1.6, 1.1, rho);
      expect(matrixSum(m)).toBeCloseTo(1, 12);
      m.p.forEach((row) => row.forEach((v) => expect(v).toBeGreaterThanOrEqual(0)));
    }
  });

  it('equals the product of Poisson marginals when ρ = 0', () => {
    const m = buildScoreMatrix(1.4, 0.9, 0);
    expect(cell(m, 2, 1)).toBeCloseTo(poissonPmf(2, 1.4) * poissonPmf(1, 0.9), 9);
    const eg = expectedGoals(m);
    expect(eg.home).toBeCloseTo(1.4, 9);
    expect(eg.away).toBeCloseTo(0.9, 9);
  });

  it('applies τ only to the four low scores and leaves the marginal means unchanged', () => {
    const plain = buildScoreMatrix(1.3, 1.0, 0);
    const dc = buildScoreMatrix(1.3, 1.0, -0.12);
    expect(cell(dc, 0, 0)).toBeCloseTo(cell(plain, 0, 0) * dcTau(0, 0, 1.3, 1.0, -0.12), 12);
    expect(cell(dc, 1, 1)).toBeCloseTo(cell(plain, 1, 1) * 1.12, 12);
    expect(cell(dc, 2, 0)).toBeCloseTo(cell(plain, 2, 0), 12);
    // A negative ρ makes 0-0 and 1-1 more likely.
    expect(cell(dc, 0, 0)).toBeGreaterThan(cell(plain, 0, 0));
    expect(cell(dc, 1, 1)).toBeGreaterThan(cell(plain, 1, 1));
    const eg = expectedGoals(dc);
    expect(eg.home).toBeCloseTo(1.3, 9);
    expect(eg.away).toBeCloseTo(1.0, 9);
  });

  it('clamps ρ so no probability becomes negative', () => {
    const [lo, hi] = rhoBounds(2, 2);
    expect(hi).toBeCloseTo(0.25);
    expect(lo).toBeCloseTo(-0.5);
    const m = buildScoreMatrix(2, 2, 5);
    expect(m.rho).toBeCloseTo(hi);
    expect(cell(m, 0, 0)).toBeGreaterThanOrEqual(0);
  });

  it('grows the grid for high-scoring expectations', () => {
    const m = buildScoreMatrix(5.5, 0.3, 0);
    expect(m.maxGoals).toBeGreaterThan(10);
    expect(matrixSum(m)).toBeCloseTo(1, 12);
  });

  it('rejects non-positive expectations', () => {
    expect(() => buildScoreMatrix(0, 1)).toThrow(RangeError);
    expect(() => buildScoreMatrix(1, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('ranks scorelines and sums events', () => {
    const m = buildScoreMatrix(1.5, 1.2, -0.1);
    const top = topScorelines(m, 3);
    expect(top[0]!.p).toBeGreaterThanOrEqual(top[1]!.p);
    expect(probabilityWhere(m, () => true)).toBeCloseTo(1, 12);
  });
});
