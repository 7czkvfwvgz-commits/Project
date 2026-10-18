import type { PredictionRow } from '@/db/repos';
import {
  brierScore,
  calibrationBins,
  hitRate,
  logLoss,
  profitAndLoss,
  rankedProbabilityScore,
  type BinaryPrediction,
  type CalibrationBin,
  type ProfitAndLoss,
} from './metrics';
import type { Outcome } from './settlement';

export interface GroupStats {
  key: string;
  n: number;
  hitRate: number;
  brier: number;
  meanProbability: number;
}

export interface Performance {
  totalSnapshots: number;
  totalRows: number;
  settledRows: number;
  /** Rows evaluated: earliest snapshot per fixture and selection, settled win/loss. */
  evaluated: number;
  hitRate: number;
  brier: number;
  logLoss: number;
  rps1x2: number;
  rpsMatches: number;
  calibration: CalibrationBin[];
  byMarket: GroupStats[];
  byCompetition: GroupStats[];
  pnl: ProfitAndLoss | null;
}

const isBinaryOutcome = (o: PredictionRow['outcome']): o is 'win' | 'loss' => o === 'win' || o === 'loss';

function group(rows: PredictionRow[], keyOf: (r: PredictionRow) => string): GroupStats[] {
  const map = new Map<string, PredictionRow[]>();
  for (const r of rows) map.set(keyOf(r), [...(map.get(keyOf(r)) ?? []), r]);
  return [...map.entries()]
    .map(([key, rs]) => {
      const preds: BinaryPrediction[] = rs.map((r) => ({ p: r.probability, y: r.outcome === 'win' ? 1 : 0 }));
      return { key, n: rs.length, hitRate: hitRate(preds), brier: brierScore(preds), meanProbability: rs.reduce((s, r) => s + r.probability, 0) / rs.length };
    })
    .sort((a, b) => b.n - a.n);
}

/**
 * Evaluate recorded predictions. Each fixture/selection counts once (its
 * earliest snapshot) so re-recording a match cannot inflate the sample.
 */
export function computePerformance(rows: PredictionRow[]): Performance {
  const snapshots = new Set(rows.map((r) => `${r.fixture_id}|${r.created_at}`));
  const earliest = new Map<string, PredictionRow>();
  for (const r of rows) {
    const k = `${r.fixture_id}|${r.selection_key}`;
    const cur = earliest.get(k);
    if (!cur || r.created_at < cur.created_at) earliest.set(k, r);
  }
  const firstRows = [...earliest.values()];
  const settled = rows.filter((r) => r.outcome !== null);
  const evaluated = firstRows.filter((r) => isBinaryOutcome(r.outcome));
  const preds: BinaryPrediction[] = evaluated.map((r) => ({ p: r.probability, y: r.outcome === 'win' ? 1 : 0 }));

  // RPS over complete 1X2 triples from the same snapshot.
  const triples = new Map<string, Partial<Record<'H' | 'D' | 'A', PredictionRow>>>();
  for (const r of firstRows) {
    if (r.market !== '1X2' || !isBinaryOutcome(r.outcome)) continue;
    const k = `${r.fixture_id}|${r.created_at}`;
    triples.set(k, { ...(triples.get(k) ?? {}), [r.selection_key.slice(-1)]: r });
  }
  const probs: number[][] = [];
  const outcomes: number[] = [];
  for (const t of triples.values()) {
    if (!t.H || !t.D || !t.A) continue;
    probs.push([t.H.probability, t.D.probability, t.A.probability]);
    outcomes.push(t.H.outcome === 'win' ? 0 : t.D.outcome === 'win' ? 1 : 2);
  }

  const withOdds = firstRows.filter((r) => r.odds !== null && r.outcome !== null && r.outcome !== 'void');
  const marketOf = (r: PredictionRow) => r.selection_key.split(':').slice(0, r.market === 'OU' ? 2 : 1).join(' ');

  return {
    totalSnapshots: snapshots.size,
    totalRows: rows.length,
    settledRows: settled.length,
    evaluated: evaluated.length,
    hitRate: hitRate(preds),
    brier: brierScore(preds),
    logLoss: logLoss(preds),
    rps1x2: rankedProbabilityScore(probs, outcomes),
    rpsMatches: probs.length,
    calibration: calibrationBins(preds, 10),
    byMarket: group(evaluated, marketOf),
    byCompetition: group(evaluated, (r) => r.competition),
    pnl: withOdds.length ? profitAndLoss(withOdds.map((r) => ({ outcome: r.outcome as Outcome, odds: r.odds as number }))) : null,
  };
}
