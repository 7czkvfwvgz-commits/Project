/* Shared setup for the screen tests (__tests__/ui-*.test.tsx). */
import { getCompetition, previousSeason, seasonForDate } from '@/config/competitions';
import { getDb } from '@/db';
import { translate } from '@/i18n';
import { OPENFOOTBALL_BASE_URL } from '@/providers/openfootball/provider';
import { resetServicesForTests } from '@/services/app';
import { useSettings } from '@/state/settings';
import { useSlip } from '@/state/slip';
import { useUi } from '@/state/ui';
import { addDays, todayKey } from '@/time/tz';
import { fakeFetch, type FakeReply } from './fakeFetch';
import { previousSeasonJson } from './leagueJson';

// Pin the clock (09:00 UTC on a Sunday) without Jest fake timers, so async work and RNTL's waitFor run normally.
export const NOW = new Date('2026-10-18T09:00:00Z');

export const bg = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) => translate('bg', key, params);

const comp = getCompetition('ENG1')!;
export const today = todayKey('Europe/Sofia', NOW.getTime());
export const season = seasonForDate(comp, today);
const prev = previousSeason(season);

const currentSeason = {
  name: 'English Premier League (test)',
  matches: [
    { round: 'Matchday 7', date: addDays(today, -7), time: '15:00', team1: 'Arsenal FC', team2: 'Chelsea FC', score: { ft: [2, 1], ht: [1, 0] } },
    { round: 'Matchday 7', date: addDays(today, -7), time: '15:00', team1: 'Leeds United FC', team2: 'Fulham FC', score: { ft: [1, 1], ht: [0, 1] } },
    { round: 'Matchday 8', date: today, time: '14:00', team1: 'Leeds United FC', team2: 'Manchester United FC' },
    { round: 'Matchday 8', date: today, time: '16:30', team1: 'Nottingham Forest FC', team2: 'Arsenal FC' },
    { round: 'Matchday 8', date: addDays(today, 1), time: '20:00', team1: 'Tottenham Hotspur FC', team2: 'Coventry City FC' },
  ],
};

export function routes(overrides: Record<string, FakeReply | Error> = {}) {
  return {
    [`${OPENFOOTBALL_BASE_URL}/${season}/en.1.json`]: { status: 200, body: currentSeason },
    [`${OPENFOOTBALL_BASE_URL}/${prev}/en.1.json`]: { status: 200, body: previousSeasonJson('EPL previous (test)', `${prev.slice(0, 4)}-08-16`) },
    ...overrides,
  };
}

export function installFetch(r: Parameters<typeof fakeFetch>[0]) {
  const ff = fakeFetch(r);
  global.fetch = ff.fetch as typeof fetch;
  return ff;
}

/** Pins the clock and resets all module-level state before each test. */
export function setupUiTests() {
  jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  jest.setTimeout(30_000);
  beforeEach(async () => {
  // Each test starts from empty storage and fresh provider instances (no cached payloads or parsed seasons).
  resetServicesForTests();
  const db = await getDb();
  await db.execAsync('DELETE FROM cache; DELETE FROM predictions; DELETE FROM favorites; DELETE FROM slip_legs; DELETE FROM slips; DELETE FROM manual_odds;');
  useSlip.setState({ legs: [], stake: 10 });
  useUi.setState({ date: null, rangeEnd: null, search: '', competitions: [], countries: [], statuses: [] });
  useSettings.setState({ enabledCompetitions: ['ENG1'], demoMode: false, timezone: 'Europe/Sofia', language: 'bg', hideBetting: false, autoRecord: false });
});
}
