import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { todayKey, type DateKey } from '@/time/tz';

/** The day shared by Home, Matches and Analysis; defaults to today in the user's zone. */
export function useSelectedDate(): [DateKey, (d: DateKey) => void] {
  const zone = useSettings((s) => s.timezone);
  const date = useUi((s) => s.date);
  const set = useUi((s) => s.set);
  return [date ?? todayKey(zone), (d) => set({ date: d, rangeEnd: null })];
}
