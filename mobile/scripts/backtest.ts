/**
 * Walk-forward backtest of the goal model on real openfootball results (CC0).
 *
 * For every match date d in a target season, the model is fitted on results
 * strictly before d (previous + current season) and the matches on d are
 * predicted. Parameters are chosen on the tuning seasons only; the test season
 * is evaluated once with the chosen parameters, so the reported test metrics
 * are out-of-sample.
 *
 *   npm run backtest                         # downloads season files
 *   OPENFOOTBALL_DIR=/path/to/football.json npm run backtest   # uses a local clone
 *
 * Writes src/data/backtest.json, which the Performance screen displays.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCompetition, previousSeason, type Competition } from '@/config/competitions';
import type { LeagueDataset } from '@/domain/types';
import { fitLeagueModel, type FitOptions } from '@/engine/fit';
import { buildHalfTimeModel } from '@/engine/halftime';
import { distributionFor } from '@/engine/markets';
import {
  argmaxAccuracy,
  brierScore,
  calibrationBins,
  expectedCalibrationError,
  logLoss,
  multiclassBrier,
  multiclassLogLoss,
  rankedProbabilityScore,
  type BinaryPrediction,
} from '@/engine/metrics';
import { expectedGoalsFor } from '@/engine/fit';
import { modelVersion } from '@/engine/predict';
import { buildScoreMatrix } from '@/engine/scoreMatrix';
import { threeWay, type Selection } from '@/engine/settlement';
import { buildLeagueDataset, parseOpenfootballSeason, type ParsedSeason } from '@/providers/openfootball/parse';

const LEAGUES = ['ENG1', 'ENG2', 'GER1', 'GER2', 'ESP1', 'ITA1', 'FRA1', 'NED1', 'POR1', 'AUT1'];
const TUNE_SEASONS = ['2023-24', '2024-25'];
const TEST_SEASON = '2025-26';
const GRID = { halfLifeDays: [90, 180, 270, 365], priorMatches: [2, 4, 8], totalShrink: [0.4, 0.55, 0.7, 0.85, 1] };
const NOW = Date.UTC(2026, 9, 18);

const ROOT = join(__dirname, '..');
const CACHE = join(ROOT, 'scripts', '.cache');

async function loadSeasonJson(code: string, season: string): Promise<unknown | null> {
  const local = process.env.OPENFOOTBALL_DIR;
  if (local) {
    const path = join(local, season, `${code}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  }
  mkdirSync(CACHE, { recursive: true });
  const cached = join(CACHE, `${season}_${code}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));
  const res = await fetch(`https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${code}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${season}/${code}`);
  const text = await res.text();
  writeFileSync(cached, text);
  return JSON.parse(text);
}

async function loadSeason(comp: Competition, season: string): Promise<ParsedSeason | null> {
  const json = await loadSeasonJson(comp.openfootball as string, season);
  return json ? parseOpenfootballSeason(json, comp, season, NOW) : null;
}

interface MatchRecord {
  league: string;
  season: string;
  p1x2: [number, number, number];
  base1x2: [number, number, number];
  outcome: 0 | 1 | 2;
  over25: number;
  over25Base: number;
  over25Y: 0 | 1;
  over15: number;
  over15Y: 0 | 1;
  under35: number;
  under35Y: 0 | 1;
  btts: number;
  bttsBase: number;
  bttsY: 0 | 1;
  ht1x2?: [number, number, number];
  htBase?: [number, number, number];
  htOutcome?: 0 | 1 | 2;
}

const IDX = { H: 0, D: 1, A: 2 } as const;
const win = (sel: Selection, ft: ReturnType<typeof buildScoreMatrix>) => (distributionFor(sel, ft, null) as { win: number }).win;

function seasonFrequencies(prev: ParsedSeason | null) {
  const h = prev?.history ?? [];
  if (h.length < 50) return { home: 0.45, draw: 0.26, away: 0.29, over25: 0.5, btts: 0.5, ht: [0.33, 0.42, 0.25] as [number, number, number] };
  const n = h.length;
  const withHt = h.filter((m) => m.ht);
  const nh = Math.max(1, withHt.length);
  return {
    ht: [
      withHt.filter((m) => m.ht!.home > m.ht!.away).length / nh,
      withHt.filter((m) => m.ht!.home === m.ht!.away).length / nh,
      withHt.filter((m) => m.ht!.home < m.ht!.away).length / nh,
    ] as [number, number, number],
    home: h.filter((m) => m.ft.home > m.ft.away).length / n,
    draw: h.filter((m) => m.ft.home === m.ft.away).length / n,
    away: h.filter((m) => m.ft.home < m.ft.away).length / n,
    over25: h.filter((m) => m.ft.home + m.ft.away > 2.5).length / n,
    btts: h.filter((m) => m.ft.home > 0 && m.ft.away > 0).length / n,
  };
}

function walkForward(league: string, season: string, dataset: LeagueDataset, base: ReturnType<typeof seasonFrequencies>, opts: Partial<FitOptions>): MatchRecord[] {
  const target = dataset.matches.filter((m) => m.season === season);
  const dates = [...new Set(target.map((m) => m.date))].sort();
  const out: MatchRecord[] = [];
  for (const date of dates) {
    const model = fitLeagueModel(dataset, date, season, opts);
    for (const m of target.filter((x) => x.date === date)) {
      const eg = expectedGoalsFor(model, m.home, m.away);
      const ft = buildScoreMatrix(eg.lambdaHome, eg.lambdaAway, model.rho);
      const p1x2: [number, number, number] = [win({ market: '1X2', pick: 'H' }, ft), win({ market: '1X2', pick: 'D' }, ft), win({ market: '1X2', pick: 'A' }, ft)];
      const total = m.ft.home + m.ft.away;
      const rec: MatchRecord = {
        league,
        season,
        p1x2,
        base1x2: [base.home, base.draw, base.away],
        outcome: IDX[threeWay(m.ft.home, m.ft.away)],
        over25: win({ market: 'OU', line: 2.5, pick: 'O' }, ft),
        over25Base: base.over25,
        over25Y: total > 2.5 ? 1 : 0,
        over15: win({ market: 'OU', line: 1.5, pick: 'O' }, ft),
        over15Y: total > 1.5 ? 1 : 0,
        under35: win({ market: 'OU', line: 3.5, pick: 'U' }, ft),
        under35Y: total < 3.5 ? 1 : 0,
        btts: win({ market: 'BTTS', pick: 'Y' }, ft),
        bttsBase: base.btts,
        bttsY: m.ft.home > 0 && m.ft.away > 0 ? 1 : 0,
      };
      if (m.ht && model.halfTime) {
        const half = buildHalfTimeModel(ft, model.halfTime);
        const htWin = (pick: 'H' | 'D' | 'A') => (distributionFor({ market: 'HT_1X2', pick }, ft, half) as { win: number }).win;
        rec.ht1x2 = [htWin('H'), htWin('D'), htWin('A')];
        rec.htBase = base.ht;
        rec.htOutcome = IDX[threeWay(m.ht.home, m.ht.away)];
      }
      out.push(rec);
    }
  }
  return out;
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

function summarise(records: MatchRecord[]) {
  const probs = records.map((r) => r.p1x2);
  const base = records.map((r) => r.base1x2);
  const outcomes = records.map((r) => r.outcome);
  const bin = (p: (r: MatchRecord) => number, y: (r: MatchRecord) => 0 | 1): BinaryPrediction[] => records.map((r) => ({ p: p(r), y: y(r) }));
  const ou25 = bin((r) => r.over25, (r) => r.over25Y);
  const ou25b = bin((r) => r.over25Base, (r) => r.over25Y);
  const btts = bin((r) => r.btts, (r) => r.bttsY);
  const bttsb = bin((r) => r.bttsBase, (r) => r.bttsY);
  const ht = records.filter((r) => r.ht1x2);
  return {
    matches: records.length,
    rps: r4(rankedProbabilityScore(probs, outcomes)),
    rpsBaseline: r4(rankedProbabilityScore(base, outcomes)),
    logLoss1x2: r4(multiclassLogLoss(probs, outcomes)),
    logLoss1x2Baseline: r4(multiclassLogLoss(base, outcomes)),
    brier1x2: r4(multiclassBrier(probs, outcomes)),
    brier1x2Baseline: r4(multiclassBrier(base, outcomes)),
    accuracy1x2: r4(argmaxAccuracy(probs, outcomes)),
    over25: { brier: r4(brierScore(ou25)), brierBaseline: r4(brierScore(ou25b)), logLoss: r4(logLoss(ou25)), logLossBaseline: r4(logLoss(ou25b)) },
    over15: { brier: r4(brierScore(bin((r) => r.over15, (r) => r.over15Y))) },
    under35: { brier: r4(brierScore(bin((r) => r.under35, (r) => r.under35Y))) },
    btts: { brier: r4(brierScore(btts)), brierBaseline: r4(brierScore(bttsb)), logLoss: r4(logLoss(btts)), logLossBaseline: r4(logLoss(bttsb)) },
    halfTime1x2:
      ht.length > 0
        ? {
            matches: ht.length,
            logLoss: r4(multiclassLogLoss(ht.map((r) => r.ht1x2 as number[]), ht.map((r) => r.htOutcome as number))),
            logLossBaseline: r4(multiclassLogLoss(ht.map((r) => r.htBase as number[]), ht.map((r) => r.htOutcome as number))),
          }
        : null,
  };
}

function calibration(preds: BinaryPrediction[]) {
  const bins = calibrationBins(preds, 10);
  return {
    ece: r4(expectedCalibrationError(bins)),
    bins: bins.map((b) => ({
      lower: b.lower,
      upper: b.upper,
      count: b.count,
      meanPredicted: Number.isNaN(b.meanPredicted) ? null : r4(b.meanPredicted),
      observed: Number.isNaN(b.observed) ? null : r4(b.observed),
      ciLow: r4(b.ciLow),
      ciHigh: r4(b.ciHigh),
    })),
  };
}

async function main() {
  const started = Date.now();
  const datasets = new Map<string, { dataset: LeagueDataset; base: ReturnType<typeof seasonFrequencies> }>();
  let goalsHome = 0;
  let goalsAway = 0;
  let goalMatches = 0;
  for (const code of LEAGUES) {
    const comp = getCompetition(code) as Competition;
    for (const season of [...TUNE_SEASONS, TEST_SEASON]) {
      const [prev, cur] = await Promise.all([loadSeason(comp, previousSeason(season)), loadSeason(comp, season)]);
      if (!cur || !prev) {
        console.warn(`skip ${code} ${season}: season file missing`);
        continue;
      }
      datasets.set(`${code}|${season}`, { dataset: buildLeagueDataset(code, [prev, cur], NOW, NOW), base: seasonFrequencies(prev) });
      for (const m of cur.history) {
        goalsHome += m.ft.home;
        goalsAway += m.ft.away;
        goalMatches++;
      }
    }
  }

  const tuneRecords = (opts: Partial<FitOptions>) => {
    const records: MatchRecord[] = [];
    for (const code of LEAGUES) {
      for (const season of TUNE_SEASONS) {
        const d = datasets.get(`${code}|${season}`);
        if (d) records.push(...walkForward(code, season, d.dataset, d.base, opts));
      }
    }
    return summarise(records);
  };

  // Stage 1: strength parameters, chosen by 1X2 ranked probability score.
  const grid: { halfLifeDays: number; priorMatches: number; rps: number; logLoss1x2: number; matches: number }[] = [];
  for (const halfLifeDays of GRID.halfLifeDays) {
    for (const priorMatches of GRID.priorMatches) {
      const s = tuneRecords({ halfLifeDays, priorMatches, totalShrink: 1 });
      grid.push({ halfLifeDays, priorMatches, rps: s.rps, logLoss1x2: s.logLoss1x2, matches: s.matches });
      console.log(`hl=${halfLifeDays} k=${priorMatches}: RPS ${s.rps} (baseline ${s.rpsBaseline}) logloss ${s.logLoss1x2} n=${s.matches}`);
    }
  }
  const best = [...grid].sort((a, b) => a.rps - b.rps || a.logLoss1x2 - b.logLoss1x2)[0] as (typeof grid)[number];

  // Stage 2: total-goals shrinkage, chosen by over/under 2.5 + BTTS log loss.
  const totalsGrid: { totalShrink: number; over25LogLoss: number; bttsLogLoss: number; rps: number }[] = [];
  for (const totalShrink of GRID.totalShrink) {
    const s = tuneRecords({ halfLifeDays: best.halfLifeDays, priorMatches: best.priorMatches, totalShrink });
    totalsGrid.push({ totalShrink, over25LogLoss: s.over25.logLoss, bttsLogLoss: s.btts.logLoss, rps: s.rps });
    console.log(`theta=${totalShrink}: O2.5 logloss ${s.over25.logLoss} (baseline ${s.over25.logLossBaseline}) BTTS ${s.btts.logLoss} (baseline ${s.btts.logLossBaseline}) RPS ${s.rps}`);
  }
  const bestTotals = [...totalsGrid].sort((a, b) => a.over25LogLoss + a.bttsLogLoss - (b.over25LogLoss + b.bttsLogLoss))[0] as (typeof totalsGrid)[number];
  const params = { halfLifeDays: best.halfLifeDays, priorMatches: best.priorMatches, totalShrink: bestTotals.totalShrink };
  console.log('chosen', params);

  const testRecords: MatchRecord[] = [];
  const byLeague: Record<string, ReturnType<typeof summarise>> = {};
  for (const code of LEAGUES) {
    const d = datasets.get(`${code}|${TEST_SEASON}`);
    if (!d) continue;
    const recs = walkForward(code, TEST_SEASON, d.dataset, d.base, params);
    byLeague[code] = summarise(recs);
    testRecords.push(...recs);
  }
  const test = summarise(testRecords);
  console.log('test', JSON.stringify(test));

  const sides: BinaryPrediction[] = testRecords.flatMap((r) => r.p1x2.map((p, k) => ({ p, y: (r.outcome === k ? 1 : 0) as 0 | 1 })));
  const output = {
    generatedAt: new Date().toISOString(),
    source: 'github.com/openfootball/football.json (CC0-1.0)',
    method: 'walk-forward; fit on results strictly before each match date (previous + current season)',
    modelVersion: modelVersion(params),
    params,
    leagues: Object.keys(byLeague),
    tuneSeasons: TUNE_SEASONS,
    testSeason: TEST_SEASON,
    observedGoalRates: { home: r4(goalsHome / goalMatches), away: r4(goalsAway / goalMatches), matches: goalMatches },
    grid,
    totalsGrid,
    test,
    byLeague,
    calibration: {
      result1x2: calibration(sides),
      over25: calibration(testRecords.map((r) => ({ p: r.over25, y: r.over25Y }))),
      btts: calibration(testRecords.map((r) => ({ p: r.btts, y: r.bttsY }))),
    },
    runtimeSeconds: Math.round((Date.now() - started) / 1000),
  };
  const outPath = join(ROOT, 'src', 'data', 'backtest.json');
  mkdirSync(join(ROOT, 'src', 'data'), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${outPath} in ${output.runtimeSeconds}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
