import { buildHalfTimeModel } from '@/engine/halftime';
import { buildMarketBook, checkConsistency, distributionFor, fairAsianLine, findEstimate, TEAM_LINES, TOTAL_LINES } from '@/engine/markets';
import { poissonCdf } from '@/engine/poisson';
import { buildScoreMatrix, cell, probabilityWhere } from '@/engine/scoreMatrix';

const shares = { homeShare: 0.45, awayShare: 0.43, sample: 400 };

describe('market book', () => {
  const ft = buildScoreMatrix(1.65, 1.05, -0.1);
  const half = buildHalfTimeModel(ft, shares);
  const book = buildMarketBook(ft, half);
  const p = (key: string) => {
    const e = findEstimate(book, key);
    if (!e) throw new Error(`missing ${key}`);
    return e.probability;
  };

  it('passes every consistency invariant', () => {
    expect(checkConsistency(ft, book)).toEqual([]);
  });

  it('1X2 sums to one and matches the matrix', () => {
    expect(p('1X2:H') + p('1X2:D') + p('1X2:A')).toBeCloseTo(1, 12);
    expect(p('1X2:H')).toBeCloseTo(probabilityWhere(ft, (h, a) => h > a), 12);
  });

  it('double chance equals the sum of its outcomes', () => {
    expect(p('DC:1X')).toBeCloseTo(p('1X2:H') + p('1X2:D'), 12);
    expect(p('DC:X2')).toBeCloseTo(p('1X2:D') + p('1X2:A'), 12);
    expect(p('DC:12')).toBeCloseTo(1 - p('1X2:D'), 12);
  });

  it('draw no bet pushes on the draw', () => {
    const d = findEstimate(book, 'DNB:H')!.dist;
    expect(d.win).toBeCloseTo(p('1X2:H'), 12);
    expect(d.push).toBeCloseTo(p('1X2:D'), 12);
    expect(d.loss).toBeCloseTo(p('1X2:A'), 12);
  });

  it.each(TOTAL_LINES)('over/under %s are complementary', (line) => {
    expect(p(`OU:${line}:O`) + p(`OU:${line}:U`)).toBeCloseTo(1, 12);
    expect(p(`OU:${line}:O`)).toBeCloseTo(probabilityWhere(ft, (h, a) => h + a > line), 12);
  });

  it('totals are monotone in the line', () => {
    for (let i = 1; i < TOTAL_LINES.length; i++) {
      expect(p(`OU:${TOTAL_LINES[i]}:O`)).toBeLessThan(p(`OU:${TOTAL_LINES[i - 1]}:O`));
    }
  });

  it('BTTS agrees with the scoreline model', () => {
    expect(p('BTTS:Y') + p('BTTS:N')).toBeCloseTo(1, 12);
    expect(p('BTTS:Y')).toBeCloseTo(probabilityWhere(ft, (h, a) => h > 0 && a > 0), 12);
  });

  it('BTTS matches the closed form for independent Poisson', () => {
    const plain = buildScoreMatrix(1.4, 1.2, 0);
    const b = buildMarketBook(plain, null);
    expect(findEstimate(b, 'BTTS:Y')!.probability).toBeCloseTo((1 - Math.exp(-1.4)) * (1 - Math.exp(-1.2)), 9);
  });

  it.each(TEAM_LINES)('team goals over %s match Poisson tails (ρ = 0)', (line) => {
    const plain = buildScoreMatrix(1.4, 1.2, 0);
    const b = buildMarketBook(plain, null);
    expect(findEstimate(b, `TEAM_OU:H:${line}:O`)!.probability).toBeCloseTo(1 - poissonCdf(Math.floor(line), 1.4), 9);
    expect(findEstimate(b, `TEAM_OU:A:${line}:O`)!.probability).toBeCloseTo(1 - poissonCdf(Math.floor(line), 1.2), 9);
    expect(findEstimate(b, `TEAM_OU:A:${line}:O`)!.probability + findEstimate(b, `TEAM_OU:A:${line}:U`)!.probability).toBeCloseTo(1, 12);
  });

  it('keeps every probability within [0, 1]', () => {
    for (const g of Object.values(book)) {
      for (const s of g.selections) {
        expect(s.probability).toBeGreaterThanOrEqual(0);
        expect(s.probability).toBeLessThanOrEqual(1);
      }
    }
  });

  it('marks corners, cards and players as unavailable instead of guessing', () => {
    for (const g of ['corners', 'cards', 'players'] as const) {
      expect(book[g].available).toBe(false);
      expect(book[g].selections).toHaveLength(0);
    }
  });

  it('half-time markets are complementary and HT/FT marginals equal the full-time model', () => {
    expect(p('HT_1X2:H') + p('HT_1X2:D') + p('HT_1X2:A')).toBeCloseTo(1, 12);
    expect(p('HT_OU:0.5:O') + p('HT_OU:0.5:U')).toBeCloseTo(1, 12);
    for (const ftPick of ['H', 'D', 'A'] as const) {
      const column = (['H', 'D', 'A'] as const).reduce((s, ht) => s + p(`HTFT:${ht}/${ftPick}`), 0);
      expect(column).toBeCloseTo(p(`1X2:${ftPick}`), 10);
    }
    // First half has fewer goals than the full match.
    expect(p('HT_OU:0.5:O')).toBeLessThan(p('OU:0.5:O'));
  });

  it('omits half-time markets when there is no half-time data', () => {
    const b = buildMarketBook(ft, null);
    expect(b.halftime.available).toBe(false);
    expect(b.halftime.unavailableReason).toBe('no_half_time_data');
    expect(distributionFor({ market: 'HT_1X2', pick: 'H' }, ft, null)).toBeNull();
  });

  it('Asian handicap settlement distributions sum to one and mirror between sides', () => {
    for (const s of book.handicap.selections) {
      const d = s.dist;
      expect(d.win + d.half_win + d.push + d.half_loss + d.loss).toBeCloseTo(1, 12);
    }
    const home = findEstimate(book, 'AH:H:-0.5')?.dist ?? distributionFor({ market: 'AH', team: 'H', line: -0.5 }, ft, null)!;
    const away = distributionFor({ market: 'AH', team: 'A', line: 0.5 }, ft, null)!;
    expect(home.win).toBeCloseTo(away.loss, 12);
    expect(home.win).toBeCloseTo(p('1X2:H'), 12);
  });

  it('centres the shown handicap lines on the fair line', () => {
    const fair = fairAsianLine(ft);
    expect(fair).toBeLessThan(0); // home favourite gives goals
    const d = distributionFor({ market: 'AH', team: 'H', line: fair }, ft, null)!;
    expect(Math.abs(d.win + d.half_win / 2 - (d.loss + d.half_loss / 2))).toBeLessThan(0.15);
  });

  it('European handicap is three-way and exhaustive', () => {
    for (const line of [-2, -1, 1, 2]) {
      const sum = (['H', 'D', 'A'] as const).reduce((s, pick) => s + distributionFor({ market: 'EH', line, pick }, ft, null)!.win, 0);
      expect(sum).toBeCloseTo(1, 12);
    }
    expect(distributionFor({ market: 'EH', line: -1, pick: 'D' }, ft, null)!.win).toBeCloseTo(
      probabilityWhere(ft, (h, a) => h - a === 1),
      12,
    );
  });

  it('correct score selections are the most likely scorelines', () => {
    const cs = book.correct_score.selections;
    expect(cs.length).toBeGreaterThan(0);
    const first = cs[0]!.selection;
    if (first.market !== 'CS') throw new Error('expected CS');
    expect(cs[0]!.probability).toBeCloseTo(cell(ft, first.home, first.away), 12);
    for (let i = 1; i < cs.length; i++) expect(cs[i]!.probability).toBeLessThanOrEqual(cs[i - 1]!.probability);
  });
});
