import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { useSettings } from '@/state/settings';
import { useSlip } from '@/state/slip';
import { bg, installFetch, routes, season, setupUiTests, today } from '../test-utils/uiHarness';

setupUiTests();

describe('Settings and slip', () => {

  it('changes the time zone', async () => {
    installFetch(routes());
    const screen = await renderRouter('./app', { initialUrl: '/settings' });
    expect(await screen.findByText(/София \(Europe\/Sofia\)/, {}, { timeout: 15_000 })).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(bg('settings.timezone')));
    await fireEvent.press(await screen.findByTestId('zone-UTC'));
    await waitFor(() => expect(screen.getByTestId('current-zone')).toHaveTextContent('UTC (UTC)'));
    expect(useSettings.getState().timezone).toBe('UTC');
  });

  it('shows an empty hypothetical slip with the responsible-use disclaimer', async () => {
    installFetch(routes());
    const screen = await renderRouter('./app', { initialUrl: '/slip' });
    expect(await screen.findByTestId('slip-empty', {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByText(bg('slip.disclaimer'))).toBeTruthy();
  });

  it('shows kickoff times in the selected time zone', async () => {
    installFetch(routes());
    useSettings.setState({ timezone: 'America/New_York' });
    const screen = await renderRouter('./app', { initialUrl: '/matches' });
    await screen.findByText('Leeds United', {}, { timeout: 15_000 });
    // 14:00 in London on a summer-time Sunday is 09:00 in New York (and 16:00 in Sofia).
    expect(screen.getByText('09:00')).toBeTruthy();
    expect(screen.queryByText('16:00')).toBeNull();
  });

  it('refuses to combine odds or multiply probabilities for selections from one match', async () => {
    installFetch(routes());
    const leg = {
      fixtureId: `of|${season}|ENG1|${today}|leeds-united|manchester-united`,
      competition: 'ENG1',
      home: 'Leeds United',
      away: 'Manchester United',
      kickoffUtc: Date.now() + 4 * 3_600_000,
      matchDate: today,
      probability: 0.4,
      odds: 2.5,
      oddsProvider: 'manual' as const,
      oddsBookmaker: null,
      oddsQuotedAt: Date.now() - 60_000,
    };
    useSlip.setState({ legs: [{ ...leg, selectionKey: '1X2:H' }, { ...leg, selectionKey: 'HT_1X2:H', probability: 0.3 }], stake: 10 });
    const screen = await renderRouter('./app', { initialUrl: '/slip' });
    expect(await screen.findByText(bg('slip.unavailableSameMatch'), {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByText(bg('slip.unavailableCorrelation'))).toBeTruthy();
    expect(screen.getByText(bg('slip.sameMatchOdds'))).toBeTruthy();
  });
});
