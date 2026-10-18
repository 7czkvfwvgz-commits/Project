import { asianOutcome, isBinaryMarket, parseSelectionKey, returnMultiplier, selectionKey, settle, type Selection } from '@/engine/settlement';

const s = (home: number, away: number) => ({ home, away });

describe('Asian handicap settlement', () => {
  // [goal difference for the backed team, line, expected]
  const table: [number, number, string][] = [
    [1, -0.5, 'win'],
    [0, -0.5, 'loss'],
    [1, -1, 'push'],
    [2, -1, 'win'],
    [0, -1, 'loss'],
    [1, -0.75, 'half_win'],
    [2, -0.75, 'win'],
    [0, -0.75, 'loss'],
    [0, -0.25, 'half_loss'],
    [1, -0.25, 'win'],
    [-1, -0.25, 'loss'],
    [0, 0.25, 'half_win'],
    [-1, 0.25, 'loss'],
    [-1, 0.75, 'half_loss'],
    [0, 0.75, 'win'],
    [-1, 1, 'push'],
    [-2, 1.5, 'loss'],
    [-1, 1.5, 'win'],
    [2, -1.25, 'win'],
    [1, -1.25, 'half_loss'],
    [2, -1.75, 'half_win'],
    [0, 0, 'push'],
  ];
  it.each(table)('margin %i at line %s → %s', (margin, line, expected) => {
    expect(asianOutcome(margin, line)).toBe(expected);
  });

  it('rejects lines that are not quarter steps', () => {
    expect(() => asianOutcome(1, -0.3)).toThrow(RangeError);
  });

  it('settles the away side from its own perspective', () => {
    expect(settle({ market: 'AH', team: 'A', line: 0.5 }, s(1, 1))).toBe('win');
    expect(settle({ market: 'AH', team: 'A', line: 0.25 }, s(1, 1))).toBe('half_win');
    expect(settle({ market: 'AH', team: 'A', line: -0.25 }, s(1, 2))).toBe('win');
  });
});

describe('goal-line settlement', () => {
  it('settles half, whole and quarter goal lines', () => {
    expect(settle({ market: 'OU', line: 2.5, pick: 'O' }, s(2, 1))).toBe('win');
    expect(settle({ market: 'OU', line: 2.5, pick: 'U' }, s(2, 1))).toBe('loss');
    expect(settle({ market: 'OU', line: 3, pick: 'O' }, s(2, 1))).toBe('push');
    expect(settle({ market: 'OU', line: 2.25, pick: 'O' }, s(1, 1))).toBe('half_loss');
    expect(settle({ market: 'OU', line: 2.25, pick: 'U' }, s(1, 1))).toBe('half_win');
    expect(settle({ market: 'OU', line: 2.75, pick: 'O' }, s(2, 1))).toBe('half_win');
    expect(settle({ market: 'OU', line: 0.5, pick: 'U' }, s(0, 0))).toBe('win');
  });

  it('settles team totals on the right team', () => {
    expect(settle({ market: 'TEAM_OU', team: 'H', line: 1.5, pick: 'O' }, s(2, 0))).toBe('win');
    expect(settle({ market: 'TEAM_OU', team: 'A', line: 1.5, pick: 'O' }, s(2, 0))).toBe('loss');
    expect(settle({ market: 'TEAM_OU', team: 'A', line: 0.5, pick: 'U' }, s(2, 0))).toBe('win');
  });
});

describe('other markets', () => {
  it('settles 1X2, double chance, BTTS, correct score and European handicap', () => {
    expect(settle({ market: '1X2', pick: 'D' }, s(1, 1))).toBe('win');
    expect(settle({ market: 'DC', pick: 'X2' }, s(0, 1))).toBe('win');
    expect(settle({ market: 'DC', pick: '12' }, s(2, 2))).toBe('loss');
    expect(settle({ market: 'DNB', pick: 'H' }, s(0, 0))).toBe('push');
    expect(settle({ market: 'BTTS', pick: 'Y' }, s(1, 0))).toBe('loss');
    expect(settle({ market: 'BTTS', pick: 'N' }, s(3, 0))).toBe('win');
    expect(settle({ market: 'CS', home: 2, away: 1 }, s(2, 1))).toBe('win');
    expect(settle({ market: 'EH', line: -1, pick: 'D' }, s(2, 1))).toBe('win');
    expect(settle({ market: 'EH', line: -1, pick: 'H' }, s(3, 1))).toBe('win');
    expect(settle({ market: 'EH', line: 1, pick: 'H' }, s(0, 1))).toBe('loss');
    expect(settle({ market: 'EH', line: 1, pick: 'D' }, s(0, 1))).toBe('win');
  });

  it('needs a half-time score for half-time markets and returns null without it', () => {
    expect(settle({ market: 'HT_1X2', pick: 'H' }, s(2, 0))).toBeNull();
    expect(settle({ market: 'HT_1X2', pick: 'H' }, s(2, 0), s(1, 0))).toBe('win');
    expect(settle({ market: 'HTFT', ht: 'D', ft: 'H' }, s(2, 0), s(0, 0))).toBe('win');
    expect(settle({ market: 'HTFT', ht: 'D', ft: 'H' }, s(2, 0))).toBeNull();
    expect(settle({ market: 'HT_OU', line: 0.5, pick: 'O' }, undefined, s(0, 1))).toBe('win');
    expect(settle({ market: '1X2', pick: 'H' }, undefined)).toBeNull();
  });
});

describe('selection keys', () => {
  const all: Selection[] = [
    { market: '1X2', pick: 'H' },
    { market: 'DC', pick: '1X' },
    { market: 'DNB', pick: 'A' },
    { market: 'OU', line: 2.5, pick: 'U' },
    { market: 'BTTS', pick: 'Y' },
    { market: 'TEAM_OU', team: 'A', line: 1.5, pick: 'O' },
    { market: 'CS', home: 3, away: 1 },
    { market: 'AH', team: 'H', line: -0.75 },
    { market: 'AH', team: 'A', line: 1.25 },
    { market: 'EH', line: -1, pick: 'D' },
    { market: 'HT_1X2', pick: 'A' },
    { market: 'HT_OU', line: 1.5, pick: 'O' },
    { market: 'HT_BTTS', pick: 'N' },
    { market: 'HTFT', ht: 'H', ft: 'D' },
  ];
  it.each(all.map((sel) => [selectionKey(sel), sel]))('round-trips %s', (key, sel) => {
    expect(parseSelectionKey(key)).toEqual(sel);
  });

  it('rejects malformed keys', () => {
    for (const bad of ['', 'XYZ:1', '1X2:Q', 'OU:abc:O', 'AH:H:-0.3', 'EH:0.5:H', 'CS:a-b', 'HTFT:H']) {
      expect(parseSelectionKey(bad)).toBeNull();
    }
  });

  it('classifies markets that can push or split as non-binary', () => {
    expect(isBinaryMarket({ market: 'OU', line: 2.5, pick: 'O' })).toBe(true);
    expect(isBinaryMarket({ market: 'OU', line: 3, pick: 'O' })).toBe(false);
    expect(isBinaryMarket({ market: 'OU', line: 2.25, pick: 'O' })).toBe(false);
    expect(isBinaryMarket({ market: 'DNB', pick: 'H' })).toBe(false);
    expect(isBinaryMarket({ market: 'AH', team: 'H', line: -0.5 })).toBe(false);
    expect(isBinaryMarket({ market: '1X2', pick: 'H' })).toBe(true);
  });

  it('computes returns per unit stake', () => {
    expect(returnMultiplier('win', 2.2)).toBeCloseTo(2.2);
    expect(returnMultiplier('half_win', 2.2)).toBeCloseTo(1.6);
    expect(returnMultiplier('push', 2.2)).toBe(1);
    expect(returnMultiplier('half_loss', 2.2)).toBe(0.5);
    expect(returnMultiplier('loss', 2.2)).toBe(0);
  });
});
