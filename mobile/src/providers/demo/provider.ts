import { DEMO_COMPETITION } from '@/config/competitions';
import { makeTeamRef } from '@/domain/teams';
import type { Fixture, HistoricalMatch, LeagueDataset } from '@/domain/types';
import { addDays, diffDays, localDateKey, parseDateKey, todayKey, zonedToUtc, type DateKey } from '@/time/tz';
import { demoFixtureId } from '../ids';
import { fieldMap, type FixtureProvider, type FixtureQuery, type ProviderCapabilities, type ProviderFixtures, type ResultsProvider } from '../types';

/**
 * Demo mode: a FICTIONAL league with invented teams and generated results,
 * shown only when the user enables it and always labelled as demo data.
 * The schedule is anchored to a fixed epoch so identifiers stay stable.
 */
const TEAMS = [
  { name: 'Демо Ястреби', attack: 1.35, defence: 0.75 },
  { name: 'Демо Вълци', attack: 1.25, defence: 0.85 },
  { name: 'Демо Орли', attack: 1.15, defence: 0.9 },
  { name: 'Демо Мечки', attack: 1.05, defence: 1.0 },
  { name: 'Демо Соколи', attack: 1.0, defence: 1.0 },
  { name: 'Демо Лъвове', attack: 0.95, defence: 1.05 },
  { name: 'Демо Рисове', attack: 0.9, defence: 1.1 },
  { name: 'Демо Елени', attack: 0.85, defence: 1.15 },
  { name: 'Демо Бизони', attack: 0.8, defence: 1.25 },
  { name: 'Демо Делфини', attack: 0.75, defence: 1.3 },
].map((t) => ({ ...t, ref: makeTeamRef(t.name) }));

const EPOCH: DateKey = '2024-01-06'; // a Saturday
const ROUNDS = 18;
const SLOTS = [
  { day: 0, hour: 15, minute: 0 },
  { day: 0, hour: 17, minute: 30 },
  { day: 0, hour: 20, minute: 0 },
  { day: 1, hour: 16, minute: 0 },
  { day: 1, hour: 18, minute: 30 },
];
const GAMMA = 1.3;
const BASE = 1.15;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(r: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > limit);
  return k - 1;
}

function pairings(): [number, number][][] {
  const n = TEAMS.length;
  const ids = [...Array(n).keys()];
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    rounds.push([...Array(n / 2).keys()].map((i) => (r % 2 === 0 ? [ids[i], ids[n - 1 - i]] : [ids[n - 1 - i], ids[i]]) as [number, number]));
    ids.splice(1, 0, ids.pop() as number);
  }
  return [...rounds, ...rounds.map((round) => round.map(([a, b]) => [b, a] as [number, number]))];
}
const PAIRINGS = pairings();

function seasonIndexFor(date: DateKey): number {
  return Math.floor(Math.max(0, diffDays(EPOCH, date)) / (7 * ROUNDS));
}

const seasonLabel = (i: number) => `DEMO-${i}`;

function seasonFixtures(index: number, nowMs: number): { fixtures: Fixture[]; history: HistoricalMatch[] } {
  const fixtures: Fixture[] = [];
  const history: HistoricalMatch[] = [];
  const season = seasonLabel(index);
  PAIRINGS.forEach((round, r) => {
    const saturday = addDays(EPOCH, (index * ROUNDS + r) * 7);
    round.forEach(([hi, ai], slot) => {
      const s = SLOTS[slot] as (typeof SLOTS)[number];
      const date = addDays(saturday, s.day);
      const { year, month, day } = parseDateKey(date);
      const kickoffUtc = zonedToUtc({ year, month, day, hour: s.hour, minute: s.minute }, DEMO_COMPETITION.tz);
      const home = TEAMS[hi] as (typeof TEAMS)[number];
      const away = TEAMS[ai] as (typeof TEAMS)[number];
      const id = demoFixtureId(season, date, home.ref.key, away.ref.key);
      const played = kickoffUtc + 2 * 3_600_000 < nowMs;
      let ft: { home: number; away: number } | undefined;
      let ht: { home: number; away: number } | undefined;
      if (played) {
        const r1 = rng(hash(id));
        const lh = BASE * GAMMA * home.attack * away.defence;
        const la = BASE * away.attack * home.defence;
        const h1 = poisson(r1, lh * 0.45);
        const a1 = poisson(r1, la * 0.45);
        ht = { home: h1, away: a1 };
        ft = { home: h1 + poisson(r1, lh * 0.55), away: a1 + poisson(r1, la * 0.55) };
        history.push({ competition: 'DEMO', season, date, kickoffUtc, home: home.ref.key, away: away.ref.key, homeName: home.name, awayName: away.name, ft, ht });
      }
      fixtures.push({
        id,
        provider: 'demo',
        links: { demo: id },
        competition: 'DEMO',
        season,
        round: String(r + 1),
        kickoffUtc,
        sourceDate: date,
        kickoffTimeSource: 'exact_utc',
        home: home.ref,
        away: away.ref,
        status: played ? 'finished' : kickoffUtc < nowMs ? 'live' : 'scheduled',
        ft,
        ht,
        isDemo: true,
      });
    });
  });
  return { fixtures, history };
}

export class DemoProvider implements FixtureProvider, ResultsProvider {
  readonly id = 'demo' as const;

  constructor(private readonly now: () => number = Date.now) {}

  capabilities(): ProviderCapabilities {
    return {
      id: this.id,
      roles: ['fixtures', 'results'],
      fields: fieldMap({ fixtures: 'supported', kickoff_time: 'supported', ft_score: 'supported', ht_score: 'supported' }),
      dataKind: 'demo',
      requiresCredentials: false,
      configured: true,
      competitions: ['DEMO'],
      homepage: '',
      terms: 'Fictional teams and generated results for demonstration only.',
      attribution: 'Demo data (fictional)',
    };
  }

  async getFixtures(query: FixtureQuery): Promise<ProviderFixtures> {
    const now = this.now();
    const fixtures: Fixture[] = [];
    for (const i of new Set([seasonIndexFor(addDays(query.from, -1)), seasonIndexFor(addDays(query.to, 1))])) {
      for (const f of seasonFixtures(i, now).fixtures) {
        const local = localDateKey(f.kickoffUtc as number, query.zone);
        if (local >= query.from && local <= query.to) fixtures.push(f);
      }
    }
    return { fixtures, covered: ['DEMO'], meta: { provider: this.id, fetchedAt: now, freshness: 'demo', stale: false } };
  }

  async getLeagueDataset(_competition: string, season: string) {
    const now = this.now();
    const index = Number(season.replace('DEMO-', ''));
    const current = Number.isFinite(index) ? index : seasonIndexFor(todayKey(DEMO_COMPETITION.tz, now));
    const seasons = [current - 1, current].filter((i) => i >= 0);
    const parts = seasons.map((i) => ({ label: seasonLabel(i), ...seasonFixtures(i, now) }));
    const teams = TEAMS.map((t) => t.ref.key).sort();
    const matches = parts.flatMap((p) => p.history).sort((a, b) => a.date.localeCompare(b.date));
    const dataset: LeagueDataset = {
      competition: 'DEMO',
      seasons: parts.map((p) => p.label),
      matches,
      currentTeams: teams,
      teamsBySeason: Object.fromEntries(parts.map((p) => [p.label, teams])),
      teamNames: Object.fromEntries(TEAMS.map((t) => [t.ref.key, t.name])),
      latestResultDate: matches[matches.length - 1]?.date ?? null,
      pendingPastFixtures: [],
      fetchedAt: now,
      provider: 'demo',
      isDemo: true,
    };
    return { dataset, meta: { provider: this.id, fetchedAt: now, freshness: 'demo' as const, stale: false } };
  }
}
