import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_ENABLED_COMPETITIONS } from '@/config/competitions';
import type { Lang } from '@/i18n';
import { DEFAULT_ZONE, isSupportedZone } from '@/time/tz';

export interface SettingsState {
  timezone: string;
  language: Lang;
  favoriteCompetitions: string[];
  enabledCompetitions: string[];
  showFairOdds: boolean;
  compactCards: boolean;
  /** Responsible use: hides odds, EV and the slip entirely. */
  hideBetting: boolean;
  rgReminders: boolean;
  /** The app sends no betting notifications; kept off unless the user opts in. */
  bettingNotifications: boolean;
  autoRecord: boolean;
  demoMode: boolean;
  lastViewedFixtureId: string | null;
  set: (patch: Partial<Omit<SettingsState, 'set' | 'toggleFavoriteCompetition' | 'toggleEnabledCompetition'>>) => void;
  toggleFavoriteCompetition: (code: string) => void;
  toggleEnabledCompetition: (code: string) => void;
}

const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      timezone: DEFAULT_ZONE,
      language: 'bg',
      favoriteCompetitions: ['ENG1', 'ESP1', 'GER1', 'ITA1'],
      enabledCompetitions: DEFAULT_ENABLED_COMPETITIONS,
      showFairOdds: false,
      compactCards: false,
      hideBetting: false,
      rgReminders: true,
      bettingNotifications: false,
      autoRecord: true,
      demoMode: false,
      lastViewedFixtureId: null,
      set: (patch) =>
        set((s) => ({
          ...patch,
          timezone: patch.timezone && isSupportedZone(patch.timezone) ? patch.timezone : s.timezone,
        })),
      toggleFavoriteCompetition: (code) => set((s) => ({ favoriteCompetitions: toggle(s.favoriteCompetitions, code) })),
      toggleEnabledCompetition: (code) => set((s) => ({ enabledCompetitions: toggle(s.enabledCompetitions, code) })),
    }),
    {
      name: 'settings',
      version: 1,
      storage: createJSONStorage(() => Storage),
      partialize: ({ set: _set, toggleFavoriteCompetition: _a, toggleEnabledCompetition: _b, ...rest }) => rest,
    },
  ),
);
