import type { Fixture, HistoricalMatch, LeagueDataset } from '@/domain/types';
import { makeTeamRef } from '@/domain/teams';
import { addDays, type DateKey } from '@/time/tz';

/** Deterministic PRNG so synthetic leagues are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function samplePoisson(rng: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

export interface SyntheticTeam {
  key: string;
  name: string;
  attack: number;
  defence: number;
}

/** Double round-robin pairings (circle method). */
function roundRobin(n: number): [number, number][][] {
  const ids = [...Array(n).keys()];
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i] as number;
      const b = ids[n - 1 - i] as number;
      round.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    ids.splice(1, 0, ids.pop() as number);
  }
  return [...rounds, ...rounds.map((round) => round.map(([a, b]) => [b, a] as [number, number]))];
}

export interface SeasonSpec {
  season: string;
  start: DateKey;
  teams: SyntheticTeam[];
  /** Rounds played (with results); later rounds are scheduled only. */
  playedRounds: number;
}

export interface SyntheticLeague {
  dataset: LeagueDataset;
  fixtures: Fixture[];
}

export function syntheticLeague(specs: SeasonSpec[], gamma: number, seed = 1, competition = 'ENG1'): SyntheticLeague {
  const rng = mulberry32(seed);
  const matches: HistoricalMatch[] = [];
  const fixtures: Fixture[] = [];
  const teamsBySeason: Record<string, string[]> = {};
  const teamNames: Record<string, string> = {};
  for (const spec of specs) {
    teamsBySeason[spec.season] = spec.teams.map((t) => t.key).sort();
    spec.teams.forEach((t) => (teamNames[t.key] = t.name));
    roundRobin(spec.teams.length).forEach((round, r) => {
      const date = addDays(spec.start, r * 7);
      for (const [hi, ai] of round) {
        const home = spec.teams[hi] as SyntheticTeam;
        const away = spec.teams[ai] as SyntheticTeam;
        const played = r < spec.playedRounds;
        let ft: { home: number; away: number } | undefined;
        let ht: { home: number; away: number } | undefined;
        if (played) {
          const h1 = samplePoisson(rng, 0.45 * gamma * home.attack * away.defence);
          const a1 = samplePoisson(rng, 0.45 * away.attack * home.defence);
          const h2 = samplePoisson(rng, 0.55 * gamma * home.attack * away.defence);
          const a2 = samplePoisson(rng, 0.55 * away.attack * home.defence);
          ht = { home: h1, away: a1 };
          ft = { home: h1 + h2, away: a1 + a2 };
          matches.push({ competition, season: spec.season, date, kickoffUtc: null, home: home.key, away: away.key, homeName: home.name, awayName: away.name, ft, ht });
        }
        fixtures.push({
          id: `of|${spec.season}|${competition}|${date}|${home.key}|${away.key}`,
          provider: 'openfootball',
          links: {},
          competition,
          season: spec.season,
          kickoffUtc: null,
          sourceDate: date,
          kickoffTimeSource: 'date_only',
          home: makeTeamRef(home.name),
          away: makeTeamRef(away.name),
          status: played ? 'finished' : 'scheduled',
          ft,
          ht,
          isDemo: false,
        });
      }
    });
  }
  matches.sort((a, b) => a.date.localeCompare(b.date));
  const last = specs[specs.length - 1] as SeasonSpec;
  return {
    dataset: {
      competition,
      seasons: specs.map((s) => s.season),
      matches,
      currentTeams: teamsBySeason[last.season] ?? [],
      teamsBySeason,
      teamNames,
      latestResultDate: matches[matches.length - 1]?.date ?? null,
      pendingPastFixtures: [],
      fetchedAt: 0,
      provider: 'openfootball',
      isDemo: false,
    },
    fixtures,
  };
}

/** Teams with names whose normalised key equals the given key. */
export function makeTeams(n: number, rng: () => number, prefix = 'Team'): SyntheticTeam[] {
  return [...Array(n).keys()].map((i) => {
    const name = `${prefix} ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? i : ''}`;
    return {
      name,
      key: makeTeamRef(name).key,
      attack: Math.exp((rng() - 0.5) * 0.8),
      defence: Math.exp((rng() - 0.5) * 0.8),
    };
  });
}

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += ((xs[i] as number) - mx) * ((ys[i] as number) - my);
    sxx += ((xs[i] as number) - mx) ** 2;
    syy += ((ys[i] as number) - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
