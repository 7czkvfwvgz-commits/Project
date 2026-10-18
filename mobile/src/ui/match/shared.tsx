import { useMemo } from 'react';
import { View } from 'react-native';
import type { Msg } from '@/i18n';
import type { OddsQuote } from '@/engine/odds';
import { bestQuotes, completeBooks, evaluateQuote } from '@/engine/odds';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/hooks/useT';
import type { MatchAnalysis } from '@/services/analysis';
import { colors } from '../theme';
import { Icon, Row, Txt } from '../components/primitives';

export function Bullets({ items, icon = 'ellipse', color = colors.textSecondary }: { items: Msg[]; icon?: 'ellipse' | 'alert-circle-outline' | 'checkmark-circle-outline' | 'remove-circle-outline'; color?: string }) {
  const { tm } = useT();
  return (
    <View style={{ gap: 6 }}>
      {items.map((m, i) => (
        <Row key={`${m.key}-${i}`} gap={8} style={{ alignItems: 'flex-start' }}>
          <Icon name={icon} size={icon === 'ellipse' ? 6 : 14} color={color} style={{ marginTop: icon === 'ellipse' ? 7 : 2 }} />
          <Txt variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
            {tm(m)}
          </Txt>
        </Row>
      ))}
    </View>
  );
}

export interface QuoteView {
  quote: OddsQuote;
  implied: number | null;
  ev: number | null;
  state: ReturnType<typeof evaluateQuote>['state'];
}

/** Best current quote per selection, with the state needed to decide whether EV may be shown. */
export function useQuoteViews(analysis: MatchAnalysis | null | undefined) {
  const now = useNow();
  return useMemo(() => {
    const map = new Map<string, QuoteView>();
    if (!analysis) return { map, books: [] as ReturnType<typeof completeBooks> };
    const kickoff = analysis.fixture.kickoffUtc;
    const current = bestQuotes(analysis.quotes, now, kickoff);
    for (const q of analysis.quotes) {
      const best = current.get(q.selectionKey);
      const chosen = best ?? q;
      if (map.has(q.selectionKey) && !best) continue;
      const est = analysis.prediction ? findDist(analysis, q.selectionKey) : null;
      const ev = est ? evaluateQuote(est, chosen, now, kickoff) : { implied: 1 / chosen.decimal, state: 'ok' as const, ev: null };
      map.set(q.selectionKey, { quote: chosen, implied: ev.implied, ev: ev.ev, state: ev.state });
    }
    return { map, books: completeBooks(analysis.quotes) };
  }, [analysis, now]);
}

function findDist(analysis: MatchAnalysis, key: string) {
  const book = analysis.prediction?.book;
  if (!book) return null;
  for (const g of Object.values(book)) {
    const hit = g.selections.find((s) => s.key === key);
    if (hit) return hit.dist;
  }
  return null;
}
