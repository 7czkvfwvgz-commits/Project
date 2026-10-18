import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { SlipLeg } from '@/engine/slip';

export interface DraftLeg extends SlipLeg {
  matchDate: string;
}

interface SlipState {
  legs: DraftLeg[];
  stake: number;
  add: (leg: DraftLeg) => void;
  remove: (fixtureId: string, selectionKey: string) => void;
  clear: () => void;
  setStake: (stake: number) => void;
  has: (fixtureId: string, selectionKey: string) => boolean;
}

/** The current hypothetical slip (research only — nothing is ever sent to a bookmaker). */
export const useSlip = create<SlipState>()(
  persist(
    (set, get) => ({
      legs: [],
      stake: 10,
      add: (leg) =>
        set((s) => (s.legs.some((l) => l.fixtureId === leg.fixtureId && l.selectionKey === leg.selectionKey) ? s : { legs: [...s.legs, leg] })),
      remove: (fixtureId, selectionKey) => set((s) => ({ legs: s.legs.filter((l) => !(l.fixtureId === fixtureId && l.selectionKey === selectionKey)) })),
      clear: () => set({ legs: [] }),
      setStake: (stake) => set({ stake: Number.isFinite(stake) && stake >= 0 ? stake : 0 }),
      has: (fixtureId, selectionKey) => get().legs.some((l) => l.fixtureId === fixtureId && l.selectionKey === selectionKey),
    }),
    {
      name: 'slip',
      version: 1,
      storage: createJSONStorage(() => Storage),
      partialize: (s) => ({ legs: s.legs, stake: s.stake }),
    },
  ),
);
