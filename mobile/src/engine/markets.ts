import type { HalfTimeModel } from './halftime';
import { EMPTY_DISTRIBUTION, type OutcomeDistribution } from './odds';
import { cell, type ScoreMatrix } from './scoreMatrix';
import { isBinaryMarket, selectionKey, selectionScope, settle, type Selection, type ThreeWay } from './settlement';

export type MarketGroup =
  | 'result'
  | 'goals'
  | 'btts'
  | 'team_goals'
  | 'halftime'
  | 'handicap'
  | 'correct_score'
  | 'corners'
  | 'cards'
  | 'players';

export const MARKET_GROUPS: MarketGroup[] = [
  'result',
  'goals',
  'btts',
  'team_goals',
  'halftime',
  'handicap',
  'correct_score',
  'corners',
  'cards',
  'players',
];

export type UnavailableReason = 'no_data_source' | 'no_half_time_data';

export interface SelectionEstimate {
  key: string;
  selection: Selection;
  group: MarketGroup;
  dist: OutcomeDistribution;
  /** Probability of a full win; see `dist` for push / half outcomes. */
  probability: number;
  binary: boolean;
}

export interface MarketGroupBook {
  group: MarketGroup;
  available: boolean;
  unavailableReason?: UnavailableReason;
  selections: SelectionEstimate[];
}

export type MarketBook = Record<MarketGroup, MarketGroupBook>;

export const TOTAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
export const TEAM_LINES = [0.5, 1.5, 2.5];
export const HT_TOTAL_LINES = [0.5, 1.5, 2.5];
export const EH_LINES = [-2, -1, 1, 2];
const AH_RANGE = 3;
const AH_SHOWN_EACH_SIDE = 4;
const CORRECT_SCORE_SHOWN = 12;

function accumulate(dist: OutcomeDistribution, outcome: keyof OutcomeDistribution | null, p: number) {
  if (outcome) dist[outcome] += p;
}

/** Settlement distribution of a selection under the model; null when the needed sub-model is missing. */
export function distributionFor(sel: Selection, ft: ScoreMatrix, half: HalfTimeModel | null): OutcomeDistribution | null {
  const dist: OutcomeDistribution = { ...EMPTY_DISTRIBUTION };
  const scope = selectionScope(sel);
  if (scope === 'ft') {
    for (let h = 0; h <= ft.maxGoals; h++) {
      for (let a = 0; a <= ft.maxGoals; a++) accumulate(dist, settle(sel, { home: h, away: a }), cell(ft, h, a));
    }
    return dist;
  }
  if (!half) return null;
  if (scope === 'ht') {
    for (let h = 0; h <= half.ht.maxGoals; h++) {
      for (let a = 0; a <= half.ht.maxGoals; a++) accumulate(dist, settle(sel, undefined, { home: h, away: a }), cell(half.ht, h, a));
    }
    return dist;
  }
  if (sel.market !== 'HTFT') return null;
  dist.win = half.htft[sel.ht][sel.ft];
  dist.loss = 1 - dist.win;
  return dist;
}

function estimate(sel: Selection, group: MarketGroup, ft: ScoreMatrix, half: HalfTimeModel | null): SelectionEstimate | null {
  const dist = distributionFor(sel, ft, half);
  if (!dist) return null;
  return { key: selectionKey(sel), selection: sel, group, dist, probability: dist.win, binary: isBinaryMarket(sel) };
}

const THREE: ThreeWay[] = ['H', 'D', 'A'];

/** The Asian line closest to an even contest for the home side. */
export function fairAsianLine(ft: ScoreMatrix): number {
  let best = 0;
  let bestGap = Infinity;
  for (let q = -AH_RANGE * 4; q <= AH_RANGE * 4; q++) {
    const line = q / 4;
    const d = distributionFor({ market: 'AH', team: 'H', line }, ft, null) as OutcomeDistribution;
    const gap = Math.abs(d.win + d.half_win / 2 - (d.loss + d.half_loss / 2));
    if (gap < bestGap) {
      bestGap = gap;
      best = line;
    }
  }
  return best;
}

export function buildMarketBook(ft: ScoreMatrix, half: HalfTimeModel | null): MarketBook {
  const make = (group: MarketGroup, sels: Selection[]): MarketGroupBook => ({
    group,
    available: true,
    selections: sels.map((s) => estimate(s, group, ft, half)).filter((e): e is SelectionEstimate => e !== null),
  });

  const result = make('result', [
    ...THREE.map((pick): Selection => ({ market: '1X2', pick })),
    ...(['1X', 'X2', '12'] as const).map((pick): Selection => ({ market: 'DC', pick })),
    { market: 'DNB', pick: 'H' },
    { market: 'DNB', pick: 'A' },
  ]);

  const goals = make(
    'goals',
    TOTAL_LINES.flatMap((line): Selection[] => [
      { market: 'OU', line, pick: 'O' },
      { market: 'OU', line, pick: 'U' },
    ]),
  );

  const btts = make('btts', [
    { market: 'BTTS', pick: 'Y' },
    { market: 'BTTS', pick: 'N' },
  ]);

  const teamGoals = make(
    'team_goals',
    (['H', 'A'] as const).flatMap((team) =>
      TEAM_LINES.flatMap((line): Selection[] => [
        { market: 'TEAM_OU', team, line, pick: 'O' },
        { market: 'TEAM_OU', team, line, pick: 'U' },
      ]),
    ),
  );

  const halftime: MarketGroupBook = half
    ? make('halftime', [
        ...THREE.map((pick): Selection => ({ market: 'HT_1X2', pick })),
        ...HT_TOTAL_LINES.flatMap((line): Selection[] => [
          { market: 'HT_OU', line, pick: 'O' },
          { market: 'HT_OU', line, pick: 'U' },
        ]),
        { market: 'HT_BTTS', pick: 'Y' },
        { market: 'HT_BTTS', pick: 'N' },
        ...THREE.flatMap((ht) => THREE.map((ftPick): Selection => ({ market: 'HTFT', ht, ft: ftPick }))),
      ])
    : { group: 'halftime', available: false, unavailableReason: 'no_half_time_data', selections: [] };

  const fair = fairAsianLine(ft);
  const ahLines: number[] = [];
  for (let i = -AH_SHOWN_EACH_SIDE; i <= AH_SHOWN_EACH_SIDE; i++) {
    const line = fair + i * 0.25;
    if (Math.abs(line) <= AH_RANGE) ahLines.push(line);
  }
  const handicap = make('handicap', [
    ...ahLines.flatMap((line): Selection[] => [
      { market: 'AH', team: 'H', line },
      { market: 'AH', team: 'A', line: line === 0 ? 0 : -line },
    ]),
    ...EH_LINES.flatMap((line) => THREE.map((pick): Selection => ({ market: 'EH', line, pick }))),
  ]);

  const scorelines: Selection[] = [];
  for (let h = 0; h <= Math.min(ft.maxGoals, 6); h++) for (let a = 0; a <= Math.min(ft.maxGoals, 6); a++) scorelines.push({ market: 'CS', home: h, away: a });
  const correctScore = make('correct_score', scorelines);
  correctScore.selections = correctScore.selections.sort((x, y) => y.probability - x.probability).slice(0, CORRECT_SCORE_SHOWN);

  // Corners, cards and player markets cannot be derived from a goal model, and no
  // configured free source provides the data needed to model them.
  const unavailable = (group: MarketGroup): MarketGroupBook => ({ group, available: false, unavailableReason: 'no_data_source', selections: [] });

  return {
    result,
    goals,
    btts,
    team_goals: teamGoals,
    halftime,
    handicap,
    correct_score: correctScore,
    corners: unavailable('corners'),
    cards: unavailable('cards'),
    players: unavailable('players'),
  };
}

export function findEstimate(book: MarketBook, key: string): SelectionEstimate | undefined {
  for (const g of MARKET_GROUPS) {
    const hit = book[g].selections.find((s) => s.key === key);
    if (hit) return hit;
  }
  return undefined;
}

export interface ConsistencyIssue {
  check: string;
  value: number;
}

const TOL = 1e-6;

/** Invariants every prediction must satisfy before it is shown. */
export function checkConsistency(ft: ScoreMatrix, book: MarketBook): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  let total = 0;
  for (let h = 0; h <= ft.maxGoals; h++) for (let a = 0; a <= ft.maxGoals; a++) total += cell(ft, h, a);
  if (Math.abs(total - 1) > TOL) issues.push({ check: 'scoreline_sum', value: total });

  const p = (key: string) => findEstimate(book, key)?.probability ?? NaN;
  const sum1x2 = p('1X2:H') + p('1X2:D') + p('1X2:A');
  if (Math.abs(sum1x2 - 1) > TOL) issues.push({ check: '1x2_sum', value: sum1x2 });
  for (const line of TOTAL_LINES) {
    const s = p(`OU:${line}:O`) + p(`OU:${line}:U`);
    if (Math.abs(s - 1) > TOL) issues.push({ check: `ou_${line}_complement`, value: s });
  }
  const btts = p('BTTS:Y') + p('BTTS:N');
  if (Math.abs(btts - 1) > TOL) issues.push({ check: 'btts_complement', value: btts });
  let bothScore = 0;
  for (let h = 1; h <= ft.maxGoals; h++) for (let a = 1; a <= ft.maxGoals; a++) bothScore += cell(ft, h, a);
  if (Math.abs(bothScore - p('BTTS:Y')) > TOL) issues.push({ check: 'btts_matrix', value: p('BTTS:Y') });

  for (const g of MARKET_GROUPS) {
    for (const s of book[g].selections) {
      const d = s.dist;
      const parts = [d.win, d.half_win, d.push, d.half_loss, d.loss];
      if (parts.some((v) => !(v >= -TOL && v <= 1 + TOL))) issues.push({ check: `range_${s.key}`, value: s.probability });
      const sum = parts.reduce((x, y) => x + y, 0);
      if (Math.abs(sum - 1) > TOL) issues.push({ check: `dist_sum_${s.key}`, value: sum });
    }
  }
  return issues;
}
