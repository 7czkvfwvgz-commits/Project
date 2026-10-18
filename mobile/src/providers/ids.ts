/**
 * Fixture identifiers are always derived from what the provider published —
 * never generated. openfootball has no match IDs, so its identifier is the
 * natural key (season, competition, published date, home, away).
 */

const SEP = '|';

export function openfootballFixtureId(season: string, competition: string, date: string, homeKey: string, awayKey: string): string {
  return ['of', season, competition, date, homeKey, awayKey].join(SEP);
}

export function footballDataFixtureId(matchId: number): string {
  return `fd${SEP}${matchId}`;
}

export function demoFixtureId(season: string, date: string, homeKey: string, awayKey: string): string {
  return ['demo', season, 'DEMO', date, homeKey, awayKey].join(SEP);
}

export type ParsedFixtureId =
  | { provider: 'openfootball'; season: string; competition: string; date: string; home: string; away: string }
  | { provider: 'football-data'; matchId: number }
  | { provider: 'demo'; season: string; date: string; home: string; away: string };

export function parseFixtureId(id: string): ParsedFixtureId | null {
  const parts = id.split(SEP);
  if (parts[0] === 'of' && parts.length === 6) {
    const [, season, competition, date, home, away] = parts as [string, string, string, string, string, string];
    return { provider: 'openfootball', season, competition, date, home, away };
  }
  if (parts[0] === 'fd' && parts.length === 2 && /^\d+$/.test(parts[1] ?? '')) {
    return { provider: 'football-data', matchId: Number(parts[1]) };
  }
  if (parts[0] === 'demo' && parts.length === 6) {
    const [, season, , date, home, away] = parts as [string, string, string, string, string, string];
    return { provider: 'demo', season, date, home, away };
  }
  return null;
}
