import {
  argmaxAccuracy,
  brierScore,
  calibrationBins,
  expectedCalibrationError,
  hitRate,
  logLoss,
  multiclassBrier,
  multiclassLogLoss,
  profitAndLoss,
  rankedProbabilityScore,
  wilsonInterval,
} from '@/engine/metrics';

describe('evaluation metrics', () => {
  it('Brier score', () => {
    expect(brierScore([{ p: 0.8, y: 1 }, { p: 0.3, y: 0 }])).toBeCloseTo((0.04 + 0.09) / 2, 12);
    expect(brierScore([])).toBeNaN();
  });

  it('log loss with clipping', () => {
    expect(logLoss([{ p: 0.5, y: 1 }])).toBeCloseTo(Math.log(2), 12);
    expect(Number.isFinite(logLoss([{ p: 0, y: 1 }]))).toBe(true);
  });

  it('hit rate', () => {
    expect(hitRate([{ p: 0.9, y: 1 }, { p: 0.6, y: 0 }, { p: 0.7, y: 1 }])).toBeCloseTo(2 / 3);
  });

  it('multi-class Brier, log loss and accuracy', () => {
    const probs = [
      [0.5, 0.3, 0.2],
      [0.2, 0.3, 0.5],
    ];
    const outcomes = [0, 1];
    expect(multiclassBrier(probs, outcomes)).toBeCloseTo((0.25 + 0.09 + 0.04 + (0.04 + 0.49 + 0.25)) / 2, 12);
    expect(multiclassLogLoss(probs, outcomes)).toBeCloseTo(-(Math.log(0.5) + Math.log(0.3)) / 2, 12);
    expect(argmaxAccuracy(probs, outcomes)).toBe(0.5);
  });

  it('ranked probability score (known example)', () => {
    // Perfect forecast scores 0; a uniform forecast on a home win scores ((2/3)^2 + (1/3)^2)/2.
    expect(rankedProbabilityScore([[1, 0, 0]], [0])).toBe(0);
    expect(rankedProbabilityScore([[1 / 3, 1 / 3, 1 / 3]], [0])).toBeCloseTo(((2 / 3) ** 2 + (1 / 3) ** 2) / 2, 12);
    // Predicting away when home happens is penalised more than predicting draw.
    expect(rankedProbabilityScore([[0, 0, 1]], [0])).toBeGreaterThan(rankedProbabilityScore([[0, 1, 0]], [0]));
  });

  it('Wilson interval', () => {
    const [lo, hi] = wilsonInterval(50, 100);
    expect(lo).toBeCloseTo(0.4038, 3);
    expect(hi).toBeCloseTo(0.5962, 3);
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });

  it('calibration bins put each prediction in exactly one bin', () => {
    const preds = [
      { p: 0.05, y: 0 as const },
      { p: 0.15, y: 0 as const },
      { p: 0.65, y: 1 as const },
      { p: 0.62, y: 0 as const },
      { p: 1, y: 1 as const },
    ];
    const bins = calibrationBins(preds, 10);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(5);
    expect(bins[6]!.count).toBe(2);
    expect(bins[6]!.observed).toBe(0.5);
    expect(bins[6]!.meanPredicted).toBeCloseTo(0.635);
    expect(bins[9]!.count).toBe(1);
    expect(expectedCalibrationError(bins)).toBeGreaterThan(0);
  });

  it('level-stakes profit and loss with settlement outcomes', () => {
    const pnl = profitAndLoss([
      { outcome: 'win', odds: 2.5 },
      { outcome: 'loss', odds: 1.8 },
      { outcome: 'push', odds: 1.9 },
      { outcome: 'half_win', odds: 2.0 },
    ]);
    expect(pnl.staked).toBe(4);
    expect(pnl.returned).toBeCloseTo(2.5 + 0 + 1 + 1.5);
    expect(pnl.profit).toBeCloseTo(1);
    expect(pnl.roi).toBeCloseTo(0.25);
  });
});
