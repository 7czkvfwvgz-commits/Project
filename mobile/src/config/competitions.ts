export interface Competition {
  /** Internal code used throughout the app. */
  code: string;
  name: { bg: string; en: string };
  country: { code: string; bg: string; en: string; flag: string };
  /** Home time zone; openfootball kickoff times are published in it. */
  tz: string;
  type: 'league' | 'cup';
  /** 'split' seasons run Aug–May ("2026-27"); 'calendar' seasons run within one year ("2026"). */
  seasonFormat: 'split' | 'calendar';
  /** File code in github.com/openfootball/football.json, when covered. */
  openfootball?: string;
  /**
   * Zone in which openfootball publishes this league's kickoff times (they carry
   * no zone). Only set where verified against explicit-offset data or standard
   * kickoff slots; otherwise times are not shown and only the date is used.
   */
  openfootballTimeZone?: string;
  /** Competition code at football-data.org (free tier), when covered. */
  footballData?: string;
  /** Sport key at the-odds-api.com, when covered. */
  oddsApi?: string;
}

const ENG = { code: 'ENG', bg: 'Англия', en: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' };
const GER = { code: 'GER', bg: 'Германия', en: 'Germany', flag: '🇩🇪' };
const ESP = { code: 'ESP', bg: 'Испания', en: 'Spain', flag: '🇪🇸' };
const ITA = { code: 'ITA', bg: 'Италия', en: 'Italy', flag: '🇮🇹' };
const FRA = { code: 'FRA', bg: 'Франция', en: 'France', flag: '🇫🇷' };

export const COMPETITIONS: readonly Competition[] = [
  { code: 'ENG1', name: { bg: 'Висша лига', en: 'Premier League' }, country: ENG, tz: 'Europe/London', type: 'league', seasonFormat: 'split', openfootball: 'en.1', openfootballTimeZone: 'Europe/London', footballData: 'PL', oddsApi: 'soccer_epl' },
  { code: 'ENG2', name: { bg: 'Чемпиъншип', en: 'Championship' }, country: ENG, tz: 'Europe/London', type: 'league', seasonFormat: 'split', openfootball: 'en.2', openfootballTimeZone: 'Europe/London', footballData: 'ELC', oddsApi: 'soccer_efl_champ' },
  { code: 'ENG3', name: { bg: 'Лига 1 (Англия)', en: 'League One' }, country: ENG, tz: 'Europe/London', type: 'league', seasonFormat: 'split', openfootball: 'en.3', oddsApi: 'soccer_england_league1' },
  { code: 'ENG4', name: { bg: 'Лига 2 (Англия)', en: 'League Two' }, country: ENG, tz: 'Europe/London', type: 'league', seasonFormat: 'split', openfootball: 'en.4', oddsApi: 'soccer_england_league2' },
  { code: 'GER1', name: { bg: 'Бундеслига', en: 'Bundesliga' }, country: GER, tz: 'Europe/Berlin', type: 'league', seasonFormat: 'split', openfootball: 'de.1', openfootballTimeZone: 'Europe/Berlin', footballData: 'BL1', oddsApi: 'soccer_germany_bundesliga' },
  { code: 'GER2', name: { bg: '2. Бундеслига', en: '2. Bundesliga' }, country: GER, tz: 'Europe/Berlin', type: 'league', seasonFormat: 'split', openfootball: 'de.2', oddsApi: 'soccer_germany_bundesliga2' },
  { code: 'ESP1', name: { bg: 'Ла Лига', en: 'La Liga' }, country: ESP, tz: 'Europe/Madrid', type: 'league', seasonFormat: 'split', openfootball: 'es.1', openfootballTimeZone: 'Europe/Madrid', footballData: 'PD', oddsApi: 'soccer_spain_la_liga' },
  { code: 'ESP2', name: { bg: 'Сегунда дивисион', en: 'Segunda División' }, country: ESP, tz: 'Europe/Madrid', type: 'league', seasonFormat: 'split', openfootball: 'es.2', oddsApi: 'soccer_spain_segunda_division' },
  { code: 'ITA1', name: { bg: 'Серия А', en: 'Serie A' }, country: ITA, tz: 'Europe/Rome', type: 'league', seasonFormat: 'split', openfootball: 'it.1', openfootballTimeZone: 'Europe/Rome', footballData: 'SA', oddsApi: 'soccer_italy_serie_a' },
  { code: 'ITA2', name: { bg: 'Серия Б', en: 'Serie B' }, country: ITA, tz: 'Europe/Rome', type: 'league', seasonFormat: 'split', openfootball: 'it.2', oddsApi: 'soccer_italy_serie_b' },
  { code: 'FRA1', name: { bg: 'Лига 1', en: 'Ligue 1' }, country: FRA, tz: 'Europe/Paris', type: 'league', seasonFormat: 'split', openfootball: 'fr.1', openfootballTimeZone: 'Europe/Paris', footballData: 'FL1', oddsApi: 'soccer_france_ligue_one' },
  { code: 'FRA2', name: { bg: 'Лига 2', en: 'Ligue 2' }, country: FRA, tz: 'Europe/Paris', type: 'league', seasonFormat: 'split', openfootball: 'fr.2', oddsApi: 'soccer_france_ligue_two' },
  { code: 'NED1', name: { bg: 'Ередивизи', en: 'Eredivisie' }, country: { code: 'NED', bg: 'Нидерландия', en: 'Netherlands', flag: '🇳🇱' }, tz: 'Europe/Amsterdam', type: 'league', seasonFormat: 'split', openfootball: 'nl.1', openfootballTimeZone: 'Europe/Amsterdam', footballData: 'DED', oddsApi: 'soccer_netherlands_eredivisie' },
  { code: 'POR1', name: { bg: 'Примейра Лига', en: 'Primeira Liga' }, country: { code: 'POR', bg: 'Португалия', en: 'Portugal', flag: '🇵🇹' }, tz: 'Europe/Lisbon', type: 'league', seasonFormat: 'split', openfootball: 'pt.1', openfootballTimeZone: 'Europe/Lisbon', footballData: 'PPL', oddsApi: 'soccer_portugal_primeira_liga' },
  { code: 'SCO1', name: { bg: 'Шотландска Премиършип', en: 'Scottish Premiership' }, country: { code: 'SCO', bg: 'Шотландия', en: 'Scotland', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' }, tz: 'Europe/London', type: 'league', seasonFormat: 'split', openfootball: 'sco.1', oddsApi: 'soccer_spl' },
  { code: 'BEL1', name: { bg: 'Белгийска Про лига', en: 'Belgian Pro League' }, country: { code: 'BEL', bg: 'Белгия', en: 'Belgium', flag: '🇧🇪' }, tz: 'Europe/Brussels', type: 'league', seasonFormat: 'split', openfootball: 'be.1', oddsApi: 'soccer_belgium_first_div' },
  { code: 'AUT1', name: { bg: 'Австрийска Бундеслига', en: 'Austrian Bundesliga' }, country: { code: 'AUT', bg: 'Австрия', en: 'Austria', flag: '🇦🇹' }, tz: 'Europe/Vienna', type: 'league', seasonFormat: 'split', openfootball: 'at.1', openfootballTimeZone: 'Europe/London', oddsApi: 'soccer_austria_bundesliga' },
  { code: 'GRE1', name: { bg: 'Гръцка Суперлига', en: 'Greek Super League' }, country: { code: 'GRE', bg: 'Гърция', en: 'Greece', flag: '🇬🇷' }, tz: 'Europe/Athens', type: 'league', seasonFormat: 'split', openfootball: 'gr.1', oddsApi: 'soccer_greece_super_league' },
  { code: 'TUR1', name: { bg: 'Турска Суперлига', en: 'Turkish Süper Lig' }, country: { code: 'TUR', bg: 'Турция', en: 'Turkey', flag: '🇹🇷' }, tz: 'Europe/Istanbul', type: 'league', seasonFormat: 'split', openfootball: 'tr.1', oddsApi: 'soccer_turkey_super_league' },
  { code: 'BRA1', name: { bg: 'Бразилия Серия А', en: 'Brasileirão Série A' }, country: { code: 'BRA', bg: 'Бразилия', en: 'Brazil', flag: '🇧🇷' }, tz: 'America/Sao_Paulo', type: 'league', seasonFormat: 'calendar', openfootball: 'br.1', openfootballTimeZone: 'America/Sao_Paulo', footballData: 'BSA', oddsApi: 'soccer_brazil_campeonato' },
  { code: 'UCL', name: { bg: 'Шампионска лига', en: 'Champions League' }, country: { code: 'EUR', bg: 'Европа', en: 'Europe', flag: '🇪🇺' }, tz: 'Europe/Paris', type: 'cup', seasonFormat: 'split', footballData: 'CL', oddsApi: 'soccer_uefa_champs_league' },
  { code: 'WC', name: { bg: 'Световно първенство', en: 'FIFA World Cup' }, country: { code: 'WLD', bg: 'Свят', en: 'World', flag: '🌍' }, tz: 'UTC', type: 'cup', seasonFormat: 'calendar', footballData: 'WC' },
  { code: 'EC', name: { bg: 'Европейско първенство', en: 'UEFA European Championship' }, country: { code: 'EUR', bg: 'Европа', en: 'Europe', flag: '🇪🇺' }, tz: 'UTC', type: 'cup', seasonFormat: 'calendar', footballData: 'EC' },
];

/** Fictional league used only in the clearly labelled demo mode. */
export const DEMO_COMPETITION: Competition = {
  code: 'DEMO',
  name: { bg: 'Демо лига (измислена)', en: 'Demo league (fictional)' },
  country: { code: 'DEMO', bg: 'Демо', en: 'Demo', flag: '🧪' },
  tz: 'Europe/Sofia',
  type: 'league',
  seasonFormat: 'calendar',
};

const BY_CODE = new Map([...COMPETITIONS, DEMO_COMPETITION].map((c) => [c.code, c]));

export function getCompetition(code: string): Competition | undefined {
  return BY_CODE.get(code);
}

export function competitionByFootballData(fdCode: string): Competition | undefined {
  return COMPETITIONS.find((c) => c.footballData === fdCode);
}

/** Leagues with a results source (openfootball, or the fictional demo league), so the goal model can be fitted. */
export function isModelSupported(code: string): boolean {
  const c = BY_CODE.get(code);
  return !!c && c.type === 'league' && (!!c.openfootball || c.code === DEMO_COMPETITION.code);
}

/** Competitions enabled by default: those with verified kickoff times or an official API. */
export const DEFAULT_ENABLED_COMPETITIONS = COMPETITIONS.filter((c) => c.openfootballTimeZone || c.footballData).map((c) => c.code);

/** Season label containing a date, e.g. 2026-10-18 → "2026-27" (split) or "2026" (calendar). */
export function seasonForDate(c: Pick<Competition, 'seasonFormat'>, dateKey: string): string {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  if (c.seasonFormat === 'calendar') return String(year);
  const start = month >= 7 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function previousSeason(season: string): string {
  if (/^\d{4}$/.test(season)) return String(Number(season) - 1);
  const start = Number(season.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function uniqueCountries(): Competition['country'][] {
  const seen = new Map<string, Competition['country']>();
  for (const c of COMPETITIONS) if (!seen.has(c.country.code)) seen.set(c.country.code, c.country);
  return [...seen.values()];
}
