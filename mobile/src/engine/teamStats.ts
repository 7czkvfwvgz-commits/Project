import type { HistoricalMatch, LeagueDataset } from '@/domain/types';
import type { DateKey } from '@/time/tz';

export interface FormEntry {
  date: DateKey;
  opponent: string;
  opponentName: string;
  venue: 'H' | 'A';
  gf: number;
  ga: number;
  htGf?: number;
  htGa?: number;
  result: 'W' | 'D' | 'L';
  competition: string;
  season: string;
}

export interface Record3 {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
}

export interface Frequencies {
  sample: number;
  cleanSheets: number;
  failedToScore: number;
  btts: number;
  over15: number;
  over25: number;
  over35: number;
}

export interface HalfSplit {
  /** Matches with a published half-time score. */
  sample: number;
  firstHalfGf: number;
  firstHalfGa: number;
  secondHalfGf: number;
  secondHalfGa: number;
}

export interface TeamSummary {
  key: string;
  name: string;
  season: string;
  last5: FormEntry[];
  last10: FormEntry[];
  overall: Record3;
  home: Record3;
  away: Record3;
  last10Freq: Frequencies;
  seasonFreq: Frequencies;
  halves: HalfSplit;
  lastResultDate: DateKey | null;
}

function entryFor(m: HistoricalMatch, team: string): FormEntry {
  const home = m.home === team;
  const gf = home ? m.ft.home : m.ft.away;
  const ga = home ? m.ft.away : m.ft.home;
  return {
    date: m.date,
    opponent: home ? m.away : m.home,
    opponentName: home ? m.awayName : m.homeName,
    venue: home ? 'H' : 'A',
    gf,
    ga,
    htGf: m.ht ? (home ? m.ht.home : m.ht.away) : undefined,
    htGa: m.ht ? (home ? m.ht.away : m.ht.home) : undefined,
    result: gf > ga ? 'W' : gf < ga ? 'L' : 'D',
    competition: m.competition,
    season: m.season,
  };
}

export function emptyRecord(): Record3 {
  return { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
}

function addToRecord(r: Record3, e: FormEntry) {
  r.played++;
  r.gf += e.gf;
  r.ga += e.ga;
  if (e.result === 'W') {
    r.won++;
    r.points += 3;
  } else if (e.result === 'D') {
    r.drawn++;
    r.points += 1;
  } else r.lost++;
}

export function frequencies(entries: FormEntry[]): Frequencies {
  const n = entries.length;
  const share = (pred: (e: FormEntry) => boolean) => (n ? entries.filter(pred).length / n : 0);
  return {
    sample: n,
    cleanSheets: share((e) => e.ga === 0),
    failedToScore: share((e) => e.gf === 0),
    btts: share((e) => e.gf > 0 && e.ga > 0),
    over15: share((e) => e.gf + e.ga > 1.5),
    over25: share((e) => e.gf + e.ga > 2.5),
    over35: share((e) => e.gf + e.ga > 3.5),
  };
}

/** Matches of `team` strictly before `asOf`, newest first. */
export function teamHistory(dataset: LeagueDataset, team: string, asOf: DateKey): FormEntry[] {
  return dataset.matches
    .filter((m) => m.date < asOf && (m.home === team || m.away === team))
    .map((m) => entryFor(m, team))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function summarizeTeam(dataset: LeagueDataset, team: string, asOf: DateKey, season: string): TeamSummary {
  const history = teamHistory(dataset, team, asOf);
  const seasonEntries = history.filter((e) => e.season === season);
  const overall = emptyRecord();
  const home = emptyRecord();
  const away = emptyRecord();
  for (const e of seasonEntries) {
    addToRecord(overall, e);
    addToRecord(e.venue === 'H' ? home : away, e);
  }
  const halves: HalfSplit = { sample: 0, firstHalfGf: 0, firstHalfGa: 0, secondHalfGf: 0, secondHalfGa: 0 };
  for (const e of seasonEntries) {
    if (e.htGf === undefined || e.htGa === undefined) continue;
    halves.sample++;
    halves.firstHalfGf += e.htGf;
    halves.firstHalfGa += e.htGa;
    halves.secondHalfGf += e.gf - e.htGf;
    halves.secondHalfGa += e.ga - e.htGa;
  }
  const last10 = history.slice(0, 10);
  return {
    key: team,
    name: dataset.teamNames[team] ?? team,
    season,
    last5: history.slice(0, 5),
    last10,
    overall,
    home,
    away,
    last10Freq: frequencies(last10),
    seasonFreq: frequencies(seasonEntries),
    halves,
    lastResultDate: history[0]?.date ?? null,
  };
}

export interface StandingRow extends Record3 {
  position: number;
  team: string;
  name: string;
  goalDifference: number;
  home: Record3;
  away: Record3;
}

/**
 * League table computed from the results present in the source before `asOf`.
 * Ordered by points, goal difference, goals scored — official tie-breakers vary
 * by league, so this can differ from the official table.
 */
export function computeStandings(dataset: LeagueDataset, season: string, asOf: DateKey): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  const teams = dataset.teamsBySeason[season] ?? [];
  const ensure = (team: string) => {
    let r = rows.get(team);
    if (!r) {
      r = { ...emptyRecord(), position: 0, team, name: dataset.teamNames[team] ?? team, goalDifference: 0, home: emptyRecord(), away: emptyRecord() };
      rows.set(team, r);
    }
    return r;
  };
  teams.forEach(ensure);
  for (const m of dataset.matches) {
    if (m.season !== season || m.date >= asOf) continue;
    for (const team of [m.home, m.away]) {
      const e = entryFor(m, team);
      const r = ensure(team);
      addToRecord(r, e);
      addToRecord(e.venue === 'H' ? r.home : r.away, e);
    }
  }
  const sorted = [...rows.values()]
    .map((r) => ({ ...r, goalDifference: r.gf - r.ga }))
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.gf - a.gf || a.name.localeCompare(b.name));
  sorted.forEach((r, i) => (r.position = i + 1));
  return sorted;
}

export function headToHead(dataset: LeagueDataset, home: string, away: string, asOf: DateKey): FormEntry[] {
  return dataset.matches
    .filter((m) => m.date < asOf && ((m.home === home && m.away === away) || (m.home === away && m.away === home)))
    .map((m) => entryFor(m, home))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export const pointsPerMatch = (r: Record3) => (r.played ? r.points / r.played : 0);
