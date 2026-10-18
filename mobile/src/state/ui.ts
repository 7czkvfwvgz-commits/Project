import { create } from 'zustand';
import type { MatchStatus } from '@/domain/types';
import { DEFAULT_FILTERS, type RankingFilters, type RankingKind, type RankingSort } from '@/engine/ranking';
import type { DateKey } from '@/time/tz';

export const MAX_RANGE_DAYS = 7;

interface UiState {
  /** Selected day; null means "today" in the user's zone. */
  date: DateKey | null;
  /** End of a multi-day range, when range mode is on. */
  rangeEnd: DateKey | null;
  search: string;
  competitions: string[];
  countries: string[];
  statuses: MatchStatus[];
  rankingKind: RankingKind;
  rankingSort: RankingSort;
  rankingFilters: RankingFilters;
  set: (patch: Partial<Omit<UiState, 'set'>>) => void;
}

export const useUi = create<UiState>()((set) => ({
  date: null,
  rangeEnd: null,
  search: '',
  competitions: [],
  countries: [],
  statuses: [],
  rankingKind: 'top_probability',
  rankingSort: 'probability',
  rankingFilters: DEFAULT_FILTERS,
  set: (patch) => set(patch),
}));
