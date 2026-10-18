import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { getCompetition } from '@/config/competitions';
import type { PredictionRow } from '@/db/repos';
import { settleSlip } from '@/engine/slip';
import { useFavorites, usePredictions, useSettle, useSlips } from '@/hooks/queries';
import { useT } from '@/hooks/useT';
import { useSettings } from '@/state/settings';
import { useSlip } from '@/state/slip';
import { MatchCard } from '@/ui/components/MatchCard';
import { Button, Card, Chip, Pill, Row, Txt } from '@/ui/components/primitives';
import { Banner, ListSkeleton, StateView } from '@/ui/components/states';
import { dateTimeText, oddsText, pct, shortDate } from '@/ui/format';
import { colors, space } from '@/ui/theme';

type Segment = 'favorites' | 'predictions' | 'slips';

interface Snapshot {
  key: string;
  rows: PredictionRow[];
}

const SHORT_KEYS = ['1X2:H', '1X2:D', '1X2:A', 'OU:2.5:O', 'BTTS:Y'] as const;

function outcomeColor(o: PredictionRow['outcome']) {
  if (o === 'win' || o === 'half_win') return colors.accent;
  if (o === 'loss' || o === 'half_loss') return colors.danger;
  return colors.neutral;
}

export default function SavedScreen() {
  const { t, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const hideBetting = useSettings((s) => s.hideBetting);
  const [segment, setSegment] = useState<Segment>('favorites');
  const favorites = useFavorites();
  const predictions = usePredictions();
  const slips = useSlips();
  const settle = useSettle();
  const draftLegs = useSlip((s) => s.legs.length);

  const snapshots = useMemo<Snapshot[]>(() => {
    const map = new Map<string, PredictionRow[]>();
    for (const r of predictions.data ?? []) {
      const k = `${r.fixture_id}|${r.created_at}`;
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()].map(([key, rows]) => ({ key, rows }));
  }, [predictions.data]);

  const refreshing = favorites.isRefetching || predictions.isRefetching || slips.isRefetching || settle.isPending;

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => settle.mutate()} tintColor={colors.accent} />}
      testID="saved-screen"
    >
      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label={t('saved.favorites')} selected={segment === 'favorites'} onPress={() => setSegment('favorites')} testID="seg-favorites" />
        <Chip label={t('saved.predictions')} selected={segment === 'predictions'} onPress={() => setSegment('predictions')} testID="seg-predictions" />
        {!hideBetting ? <Chip label={t('saved.slips')} selected={segment === 'slips'} onPress={() => setSegment('slips')} testID="seg-slips" /> : null}
      </Row>
      <Row style={{ flexWrap: 'wrap' }}>
        <Button label={t('saved.performance')} kind="secondary" icon="analytics-outline" onPress={() => router.push('/performance')} />
        {!hideBetting ? <Button label={t('saved.openSlip', { n: draftLegs })} kind="secondary" icon="receipt-outline" onPress={() => router.push('/slip')} /> : null}
      </Row>
      <Row>
        <Button label={settle.isPending ? t('saved.settling') : t('saved.settle')} kind="secondary" icon="checkmark-done-outline" onPress={() => settle.mutate()} disabled={settle.isPending} />
        {settle.data ? (
          <Txt variant="caption" color={colors.textMuted}>
            {t('saved.settledCount', { n: settle.data.predictions + settle.data.legs })}
          </Txt>
        ) : null}
      </Row>
      <Txt variant="caption" color={colors.textMuted}>
        {t('saved.offlineOk')}
      </Txt>

      {segment === 'favorites' ? (
        favorites.isLoading ? (
          <ListSkeleton count={2} />
        ) : (favorites.data ?? []).length === 0 ? (
          <StateView icon="star-outline" title={t('saved.noFavorites')} />
        ) : (
          (favorites.data ?? []).map((f) => <MatchCard key={f.id} fixture={f} zone={zone} />)
        )
      ) : null}

      {segment === 'predictions' ? (
        predictions.isLoading ? (
          <ListSkeleton count={2} />
        ) : snapshots.length === 0 ? (
          <StateView icon="bookmark-outline" title={t('saved.noPredictions')} />
        ) : (
          snapshots.map(({ key, rows }) => {
            const first = rows[0] as PredictionRow;
            const comp = getCompetition(first.competition);
            const settled = rows.filter((r) => r.outcome !== null).length;
            return (
              <Card key={key} onPress={() => router.push({ pathname: '/match/[id]', params: { id: first.fixture_id } })}>
                <Row>
                  <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }} numberOfLines={1}>
                    {comp?.country.flag} {comp?.name[lang]} • {shortDate(first.match_date)}
                  </Txt>
                  <Pill label={settled === rows.length ? t('perf.settled') : t('outcome.pending')} color={settled === rows.length ? colors.accent : colors.neutral} />
                </Row>
                <Txt variant="bodyStrong">
                  {first.home} – {first.away}
                  {first.final_home !== null ? `  ${first.final_home}:${first.final_away}` : ''}
                </Txt>
                <Txt variant="caption" color={colors.textMuted}>
                  {dateTimeText(first.created_at, zone)} • {first.model_version} • {first.snapshot_source}
                </Txt>
                <Row style={{ flexWrap: 'wrap' }} gap={6}>
                  {rows
                    .filter((r) => (SHORT_KEYS as readonly string[]).includes(r.selection_key))
                    .map((r) => {
                      const label =
                        r.selection_key === '1X2:H' ? '1' : r.selection_key === '1X2:D' ? 'X' : r.selection_key === '1X2:A' ? '2' : r.selection_key === 'OU:2.5:O' ? t('sel.over', { line: 2.5 }) : t('group.btts');
                      return <Pill key={r.id} label={`${label} ${pct(r.probability)}`} color={outcomeColor(r.outcome)} />;
                    })}
                </Row>
              </Card>
            );
          })
        )
      ) : null}

      {segment === 'slips' && !hideBetting ? (
        <>
          <Banner tone="neutral" icon="shield-checkmark-outline" text={t('slip.disclaimer')} />
          {slips.isLoading ? (
            <ListSkeleton count={2} />
          ) : (slips.data ?? []).length === 0 ? (
            <StateView icon="receipt-outline" title={t('saved.noSlips')} />
          ) : (
            (slips.data ?? []).map((s) => {
              const result = settleSlip(s.legs, s.stake);
              return (
                <Card key={s.id} onPress={() => router.push({ pathname: '/slips/[id]', params: { id: String(s.id) } })}>
                  <Row>
                    <Txt variant="bodyStrong" style={{ flex: 1 }}>
                      {s.name}
                    </Txt>
                    <Pill label={t(`slip.status.${result.status}`)} color={result.status === 'won' ? colors.accent : result.status === 'lost' ? colors.danger : colors.neutral} />
                  </Row>
                  <Txt variant="caption" color={colors.textMuted}>
                    {dateTimeText(s.created_at, zone)} • {t('slip.legs', { n: s.legs.length })} • {t('slip.stake')}: {s.stake} • {t('slip.combinedOdds')}: {oddsText(s.combined_odds)}
                  </Txt>
                  {result.returnAmount !== null ? (
                    <Txt variant="small" color={colors.textSecondary}>
                      {t('slip.return', { amount: result.returnAmount.toFixed(2) })}
                    </Txt>
                  ) : null}
                </Card>
              );
            })
          )}
        </>
      ) : null}
      <View />
    </ScrollView>
  );
}
