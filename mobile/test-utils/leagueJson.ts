import { addDays, type DateKey } from '@/time/tz';

/** Real Premier League club names, used to build openfootball-shaped test payloads. */
export const EPL_TEAMS = [
  'Arsenal FC',
  'Aston Villa FC',
  'AFC Bournemouth',
  'Brentford FC',
  'Brighton & Hove Albion FC',
  'Chelsea FC',
  'Crystal Palace FC',
  'Everton FC',
  'Fulham FC',
  'Leeds United FC',
  'Liverpool FC',
  'Manchester City FC',
  'Manchester United FC',
  'Newcastle United FC',
  'Nottingham Forest FC',
  'Sunderland AFC',
  'Tottenham Hotspur FC',
  'Coventry City FC',
  'Hull City AFC',
  'Ipswich Town FC',
];

interface OfMatch {
  round: string;
  date: string;
  time?: string;
  team1: string;
  team2: string;
  score?: { ft: [number, number]; ht: [number, number] };
}

/** A full, deterministic previous season (double round robin) in openfootball's JSON shape. */
export function previousSeasonJson(name: string, start: DateKey, teams = EPL_TEAMS): { name: string; matches: OfMatch[] } {
  const matches: OfMatch[] = [];
  let round = 0;
  for (let i = 0; i < teams.length; i++) {
    for (let j = 0; j < teams.length; j++) {
      if (i === j) continue;
      const h = (i * 7 + j * 3) % 4;
      const a = (i * 2 + j * 5) % 3;
      matches.push({
        round: `Matchday ${1 + (round % 38)}`,
        date: addDays(start, Math.floor(round / 10) * 7),
        time: '15:00',
        team1: teams[i] as string,
        team2: teams[j] as string,
        score: { ft: [h, a], ht: [Math.min(h, 1), Math.min(a, 1)] },
      });
      round++;
    }
  }
  return { name, matches };
}
