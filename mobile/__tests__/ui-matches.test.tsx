import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { useSettings } from '@/state/settings';
import { OPENFOOTBALL_BASE_URL } from '@/providers/openfootball/provider';
import { bg, installFetch, routes, setupUiTests } from '../test-utils/uiHarness';

setupUiTests();

describe('Matches screen', () => {
  it('lists today’s fixtures in the local zone with source attribution', async () => {
    installFetch(routes());
    const screen = await renderRouter('./app', { initialUrl: '/matches' });
    expect(await screen.findByText('Leeds United', {}, { timeout: 15_000 })).toBeTruthy();
    expect(screen.getByText('Nottingham Forest')).toBeTruthy();
    // 14:00 in London is 16:00 in Sofia.
    expect(screen.getByText('16:00')).toBeTruthy();
    expect(screen.queryByText('Tottenham Hotspur')).toBeNull();
    expect(screen.getByTestId('source-footer')).toBeTruthy();
    expect(screen.getByText(/openfootball: 2 мача/)).toBeTruthy();
  });

  it('filters by team search', async () => {
    installFetch(routes());
    const screen = await renderRouter('./app', { initialUrl: '/matches' });
    await screen.findByText('Leeds United', {}, { timeout: 15_000 });
    await fireEvent.changeText(screen.getByTestId('matches-search'), 'forest');
    await waitFor(() => expect(screen.queryByText('Leeds United')).toBeNull());
    expect(screen.getByText('Nottingham Forest')).toBeTruthy();
  });

  it('reports an API failure without claiming there are no matches', async () => {
    installFetch({ [OPENFOOTBALL_BASE_URL]: new Error('network down') });
    const screen = await renderRouter('./app', { initialUrl: '/matches' });
    expect(await screen.findByTestId('state-api-failure', {}, { timeout: 20_000 })).toBeTruthy();
    expect(screen.getByText(bg('list.apiFailure'))).toBeTruthy();
  });

  it('reports missing coverage when the source has no season', async () => {
    installFetch({});
    const screen = await renderRouter('./app', { initialUrl: '/matches' });
    expect(await screen.findByTestId('state-no-coverage', {}, { timeout: 15_000 })).toBeTruthy();
  });

  it('labels demo data clearly', async () => {
    installFetch({});
    useSettings.setState({ demoMode: true });
    const screen = await renderRouter('./app', { initialUrl: '/matches' });
    expect(await screen.findByTestId('demo-banner', {}, { timeout: 15_000 })).toBeTruthy();
    expect((await screen.findAllByText(/^Демо /)).length).toBeGreaterThan(0);
  });
});
