import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/**
 * A timestamp for render-time calculations (odds staleness, kickoff checks).
 * Captured once and refreshed whenever the screen regains focus, so renders
 * stay pure and the value never drifts far.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
    }, []),
  );
  return now;
}
