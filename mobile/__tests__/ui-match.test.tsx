import { fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { Alert } from 'react-native';
import { getDb } from '@/db';
import { bg, installFetch, routes, season, setupUiTests, today } from '../test-utils/uiHarness';

setupUiTests();

describe('Match analysis screen', () => {
  const id = `of|${season}|ENG1|${today}|leeds-united|manchester-united`;

  it('shows model probabilities, “odds unavailable”, and refuses to invent advanced data', async () => {
    installFetch(routes());
    const screen = await renderRouter('./app', { initialUrl: `/match/${encodeURIComponent(id)}` });
    expect(await screen.findByTestId('match-screen', {}, { timeout: 15_000 })).toBeTruthy();
    expect(await screen.findByTestId('odds-unavailable')).toBeTruthy();
    expect(screen.getByText(bg('match.expectedGoals'))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('tab-markets'));
    expect(await screen.findByTestId('sel-1X2:H')).toBeTruthy();
    expect(screen.getByTestId('sel-DNB:H')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('group-goals'));
    expect(await screen.findByTestId('sel-OU:2.5:O')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('group-corners'));
    expect(await screen.findByTestId('market-unavailable')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('tab-stats'));
    expect(await screen.findByTestId('advanced-data')).toBeTruthy();
    expect(screen.getAllByText(bg('stats.advancedUnavailable')).length).toBe(6);

    await fireEvent.press(screen.getByTestId('tab-explain'));
    expect(await screen.findByText(bg('exp.title'))).toBeTruthy();
  });

  it('records a prediction snapshot before kickoff', async () => {
    installFetch(routes());
    const screen = await renderRouter('./app', { initialUrl: `/match/${encodeURIComponent(id)}` });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const button = await screen.findByTestId('record-prediction', {}, { timeout: 15_000 });
    await fireEvent.press(button);
    // The confirmation proves the mutation finished before the test ends.
    await waitFor(() => expect(alert).toHaveBeenCalledWith(bg('match.recordPrediction'), bg('match.recorded', { n: 11 })));
    alert.mockRestore();
    // @/db is backed by Node's SQLite in tests (see jest.setup.js).
    await waitFor(async () => {
      const db = await getDb();
      const rows = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM predictions WHERE fixture_id = ?', [id]);
      expect(rows[0]!.n).toBe(11);
    });
  });

  it('shows a not-found state for an unknown id', async () => {
    installFetch(routes());
    const screen = await renderRouter('./app', { initialUrl: `/match/${encodeURIComponent(`of|${season}|ENG1|${today}|nobody|noone`)}` });
    expect(await screen.findByTestId('match-not-found', {}, { timeout: 15_000 })).toBeTruthy();
  });
});
