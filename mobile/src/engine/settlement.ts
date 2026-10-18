import type { Score } from '@/domain/types';

export type Side = 'H' | 'A';
export type ThreeWay = 'H' | 'D' | 'A';
export type OverUnder = 'O' | 'U';
export type YesNo = 'Y' | 'N';

/** A precisely defined betting selection. Probabilities and settlement both derive from this definition. */
export type Selection =
  | { market: '1X2'; pick: ThreeWay }
  | { market: 'DC'; pick: '1X' | 'X2' | '12' }
  | { market: 'DNB'; pick: Side }
  | { market: 'OU'; line: number; pick: OverUnder }
  | { market: 'BTTS'; pick: YesNo }
  | { market: 'TEAM_OU'; team: Side; line: number; pick: OverUnder }
  | { market: 'CS'; home: number; away: number }
  /** Asian handicap; `line` is from the backed team's perspective (e.g. H −0.75). */
  | { market: 'AH'; team: Side; line: number }
  /** European (3-way) handicap; integer `line` is added to the home team's goals. */
  | { market: 'EH'; line: number; pick: ThreeWay }
  | { market: 'HT_1X2'; pick: ThreeWay }
  | { market: 'HT_OU'; line: number; pick: OverUnder }
  | { market: 'HT_BTTS'; pick: YesNo }
  | { market: 'HTFT'; ht: ThreeWay; ft: ThreeWay };

export type MarketKey = Selection['market'];

export type Outcome = 'win' | 'half_win' | 'push' | 'half_loss' | 'loss';

/** Which part of the match a selection is decided on. */
export type SelectionScope = 'ft' | 'ht' | 'htft';

export function selectionScope(sel: Selection): SelectionScope {
  if (sel.market === 'HTFT') return 'htft';
  if (sel.market === 'HT_1X2' || sel.market === 'HT_OU' || sel.market === 'HT_BTTS') return 'ht';
  return 'ft';
}

const fmtLine = (n: number) => (n > 0 ? `+${n}` : String(n));

export function selectionKey(sel: Selection): string {
  switch (sel.market) {
    case '1X2':
    case 'DC':
    case 'DNB':
    case 'BTTS':
    case 'HT_1X2':
    case 'HT_BTTS':
      return `${sel.market}:${sel.pick}`;
    case 'OU':
    case 'HT_OU':
      return `${sel.market}:${sel.line}:${sel.pick}`;
    case 'TEAM_OU':
      return `TEAM_OU:${sel.team}:${sel.line}:${sel.pick}`;
    case 'CS':
      return `CS:${sel.home}-${sel.away}`;
    case 'AH':
      return `AH:${sel.team}:${fmtLine(sel.line)}`;
    case 'EH':
      return `EH:${fmtLine(sel.line)}:${sel.pick}`;
    case 'HTFT':
      return `HTFT:${sel.ht}/${sel.ft}`;
  }
}

const isThreeWay = (v: string | undefined): v is ThreeWay => v === 'H' || v === 'D' || v === 'A';
const isSide = (v: string | undefined): v is Side => v === 'H' || v === 'A';
const isOU = (v: string | undefined): v is OverUnder => v === 'O' || v === 'U';
const isYN = (v: string | undefined): v is YesNo => v === 'Y' || v === 'N';

function parseNumber(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Inverse of selectionKey; returns null for anything malformed (e.g. a corrupted DB row). */
export function parseSelectionKey(key: string): Selection | null {
  const parts = key.split(':');
  const [market, a, b, c] = parts;
  switch (market) {
    case '1X2':
    case 'HT_1X2':
      return isThreeWay(a) ? { market, pick: a } : null;
    case 'DC':
      return a === '1X' || a === 'X2' || a === '12' ? { market, pick: a } : null;
    case 'DNB':
      return isSide(a) ? { market, pick: a } : null;
    case 'BTTS':
    case 'HT_BTTS':
      return isYN(a) ? { market, pick: a } : null;
    case 'OU':
    case 'HT_OU': {
      const line = parseNumber(a);
      return line !== null && isOU(b) ? { market, line, pick: b } : null;
    }
    case 'TEAM_OU': {
      const line = parseNumber(b);
      return isSide(a) && line !== null && isOU(c) ? { market, team: a, line, pick: c } : null;
    }
    case 'CS': {
      const m = /^(\d+)-(\d+)$/.exec(a ?? '');
      return m ? { market, home: Number(m[1]), away: Number(m[2]) } : null;
    }
    case 'AH': {
      const line = parseNumber(b);
      return isSide(a) && line !== null && isQuarterStep(line) ? { market, team: a, line } : null;
    }
    case 'EH': {
      const line = parseNumber(a);
      return line !== null && Number.isInteger(line) && isThreeWay(b) ? { market, line, pick: b } : null;
    }
    case 'HTFT': {
      const [ht, ft] = (a ?? '').split('/');
      return isThreeWay(ht) && isThreeWay(ft) ? { market, ht, ft } : null;
    }
    default:
      return null;
  }
}

function isQuarterStep(line: number): boolean {
  return Number.isInteger(line * 4);
}

/** True for .25 / .75 lines, which split the stake across the two neighbouring half-lines. */
export function isQuarterLine(line: number): boolean {
  return Number.isInteger(line * 4) && !Number.isInteger(line * 2);
}

function single(adjusted: number): 'win' | 'push' | 'loss' {
  if (adjusted > 0) return 'win';
  if (adjusted < 0) return 'loss';
  return 'push';
}

/**
 * Asian settlement of `value + line`: positive wins, zero pushes, negative loses.
 * Quarter lines put half the stake on line − 0.25 and half on line + 0.25.
 */
export function asianOutcome(value: number, line: number): Outcome {
  if (!isQuarterStep(line)) throw new RangeError(`Asian lines must be multiples of 0.25 (got ${line})`);
  if (!isQuarterLine(line)) return single(value + line);
  const lower = single(value + line - 0.25);
  const upper = single(value + line + 0.25);
  if (lower === upper) return lower;
  const pair = new Set([lower, upper]);
  if (pair.has('win') && pair.has('push')) return 'half_win';
  if (pair.has('loss') && pair.has('push')) return 'half_loss';
  // Adjacent half-lines 0.5 apart cannot produce a win and a loss for integer goals.
  throw new Error(`Inconsistent quarter-line settlement for value ${value}, line ${line}`);
}

export function threeWay(home: number, away: number): ThreeWay {
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
}

const winIf = (condition: boolean): Outcome => (condition ? 'win' : 'loss');

function overUnder(total: number, line: number, pick: OverUnder): Outcome {
  return pick === 'O' ? asianOutcome(total, -line) : asianOutcome(-total, line);
}

/**
 * Settle a selection against final scores. Returns null when the needed score
 * is missing (e.g. a half-time market without a half-time score).
 */
export function settle(sel: Selection, ft: Score | undefined, ht?: Score): Outcome | null {
  const scope = selectionScope(sel);
  if (scope !== 'ht' && !ft) return null;
  if (scope !== 'ft' && !ht) return null;
  const f = ft as Score;
  const h = ht as Score;
  switch (sel.market) {
    case '1X2':
      return winIf(threeWay(f.home, f.away) === sel.pick);
    case 'DC': {
      const r = threeWay(f.home, f.away);
      const covered = sel.pick === '1X' ? r !== 'A' : sel.pick === 'X2' ? r !== 'H' : r !== 'D';
      return winIf(covered);
    }
    case 'DNB':
      return asianOutcome(sel.pick === 'H' ? f.home - f.away : f.away - f.home, 0);
    case 'OU':
      return overUnder(f.home + f.away, sel.line, sel.pick);
    case 'BTTS': {
      const both = f.home > 0 && f.away > 0;
      return winIf(sel.pick === 'Y' ? both : !both);
    }
    case 'TEAM_OU':
      return overUnder(sel.team === 'H' ? f.home : f.away, sel.line, sel.pick);
    case 'CS':
      return winIf(f.home === sel.home && f.away === sel.away);
    case 'AH':
      return asianOutcome(sel.team === 'H' ? f.home - f.away : f.away - f.home, sel.line);
    case 'EH':
      return winIf(threeWay(f.home + sel.line, f.away) === sel.pick);
    case 'HT_1X2':
      return winIf(threeWay(h.home, h.away) === sel.pick);
    case 'HT_OU':
      return overUnder(h.home + h.away, sel.line, sel.pick);
    case 'HT_BTTS': {
      const both = h.home > 0 && h.away > 0;
      return winIf(sel.pick === 'Y' ? both : !both);
    }
    case 'HTFT':
      return winIf(threeWay(h.home, h.away) === sel.ht && threeWay(f.home, f.away) === sel.ft);
  }
}

/** Return per unit stake (including the stake) for an outcome at decimal odds. */
export function returnMultiplier(outcome: Outcome, decimalOdds: number): number {
  switch (outcome) {
    case 'win':
      return decimalOdds;
    case 'half_win':
      return (decimalOdds + 1) / 2;
    case 'push':
      return 1;
    case 'half_loss':
      return 0.5;
    case 'loss':
      return 0;
  }
}

/** Binary markets settle only as win or loss; others can push or split. */
export function isBinaryMarket(sel: Selection): boolean {
  if (sel.market === 'DNB') return false;
  if (sel.market === 'AH') return false;
  if (sel.market === 'OU' || sel.market === 'HT_OU' || sel.market === 'TEAM_OU') return Math.abs(sel.line % 1) === 0.5;
  return true;
}
