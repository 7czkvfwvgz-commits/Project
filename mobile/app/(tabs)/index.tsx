import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { getCompetition } from '@/config/competitions';
import { DEFAULT_FILTERS, rankSelections } from '@/engine/ranking';
import { useShortlist } from '@/hooks/queries';
import { useNow } from '@/hooks/useNow';
import { useSelectedDate } from '@/hooks/useSelectedDate';
import { useT } from '@/hooks/useT';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { DateBar } from '@/ui/components/DateBar';
import { EmptyListState, ListBanners, SourceFooter } from '@/ui/components/ListStatus';
import { MatchCard } from '@/ui/components/MatchCard';
import { Card, Chip, Icon, Row, SectionHeader, Txt } from '@/ui/components/primitives';
import { RankedItemCard } from '@/ui/components/RankedItemCard';
import { Banner, DemoBanner, ListSkeleton, OfflineBanner, Skeleton, StateView } from '@/ui/components/states';
import { shortDate } from '@/ui/format';
import { colors, radius, space } from '@/ui/theme';

export default function HomeScreen() {
  const { t, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const favorites = useSettings((s) => s.favoriteCompetitions);
  const demo = useSettings((s) => s.demoMode);
  const compact = useSettings((s) => s.compactCards);
  const rg = useSettings((s) => s.rgReminders);
  const setUi = useUi((s) => s.set);
  const [date, setDate] = useSelectedDate();
  const [search, setSearch] = useState('');
  const { fixtures, shortlist } = useShortlist(date);
  const now = useNow();
  const data = fixtures.data;

  const probabilities = useMemo(() => {
    const map = new Map<string, { h: number; d: number; a: number; uncertain: boolean }>();
    for (const input of shortlist.data?.inputs ?? []) {
      const r = input.prediction.book.result.selections;
      const p = (k: string) => r.find((s) => s.key === k)?.probability ?? 0;
      map.set(input.fixture.id, { h: p('1X2:H'), d: p('1X2:D'), a: p('1X2:A'), uncertain: input.prediction.confidence.level === 'low' });
    }
    return map;
  }, [shortlist.data]);

  const upcoming = useMemo(() => {
    const list = (data?.fixtures ?? []).filter((f) => f.status === 'scheduled' || f.status === 'live');
    const fav = (c: string) => (favorites.includes(c) ? 0 : 1);
    return [...list].sort((a, b) => fav(a.competition) - fav(b.competition)).slice(0, 6);
  }, [data, favorites]);

  const top = useMemo(
    () => (shortlist.data ? rankSelections(shortlist.data.inputs, 'top_probability', DEFAULT_FILTERS, 'probability', now).slice(0, 3) : []),
    [shortlist.data, now],
  );

  const freshness = useMemo(() => {
    const ds = shortlist.data?.datasets ?? [];
    if (ds.length === 0) return null;
    const latest = ds.map((d) => d.dataset.latestResultDate).filter((x): x is string => !!x).sort();
    const pending = ds.reduce((s, d) => s + d.dataset.pendingPastFixtures.length, 0);
    return { oldest: latest[0] ?? null, newest: latest[latest.length - 1] ?? null, pending, count: ds.length };
  }, [shortlist.data]);

  const submitSearch = () => {
    setUi({ search: search.trim() });
    router.navigate('/matches');
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={fixtures.isRefetching} onRefresh={() => fixtures.refresh()} tintColor={colors.accent} />}
      testID="home-screen"
    >
      {demo ? <DemoBanner /> : null}
      <OfflineBanner />
      <Txt variant="small" color={colors.textSecondary}>
        {t('home.subtitle')}
      </Txt>

      <DateBar date={date} zone={zone} onChange={setDate} />

      <Row style={styles.search}>
        <Icon name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={submitSearch}
          placeholder={t('home.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          style={styles.searchInput}
          accessibilityLabel={t('common.search')}
          testID="home-search"
        />
      </Row>

      <SectionHeader title={t('home.dataFreshness')} />
      <Card>
        {freshness?.newest ? (
          <Txt variant="small" color={colors.textSecondary}>
            {t('fresh.resultsUntil', { date: freshness.oldest === freshness.newest ? shortDate(freshness.newest) : `${shortDate(freshness.oldest as string)} – ${shortDate(freshness.newest)}` })}
          </Txt>
        ) : null}
        {freshness && freshness.pending > 0 ? (
          <Txt variant="small" color={colors.warning}>
            {t('fresh.pendingResults', { n: freshness.pending })}
          </Txt>
        ) : null}
        {data ? <SourceFooter data={data} /> : <Skeleton height={14} />}
      </Card>

      <SectionHeader title={t('home.upcoming')} action={t('home.seeAll')} onAction={() => router.navigate('/matches')} />
      {data ? <ListBanners data={data} zone={zone} /> : null}
      {fixtures.isLoading ? (
        <ListSkeleton count={3} />
      ) : fixtures.isError ? (
        <StateView icon="cloud-offline" tone="danger" title={t('error.network')} message={t('list.apiFailure')} actionLabel={t('common.retry')} onAction={() => fixtures.refresh()} />
      ) : upcoming.length > 0 ? (
        <View style={{ gap: space.sm }}>
          {upcoming.map((f) => (
            <MatchCard key={f.id} fixture={f} zone={zone} probabilities={probabilities.get(f.id)} compact={compact} />
          ))}
        </View>
      ) : data && data.fixtures.length === 0 ? (
        <EmptyListState data={data} onRetry={() => fixtures.refresh()} filtered={false} />
      ) : (
        <Txt variant="small" color={colors.textSecondary}>
          {t('home.noUpcoming')}
        </Txt>
      )}

      <SectionHeader title={t('home.shortlist')} action={t('home.seeAll')} onAction={() => router.navigate('/analysis')} />
      <Txt variant="caption" color={colors.textMuted}>
        {t('home.shortlistHint')}
      </Txt>
      {shortlist.isLoading || (fixtures.isSuccess && shortlist.isPending) ? (
        <View style={{ gap: space.sm }}>
          <Skeleton height={90} />
          <Txt variant="caption" color={colors.textMuted}>
            {t('analysis.computing')}
          </Txt>
        </View>
      ) : top.length > 0 ? (
        <View style={{ gap: space.sm }}>
          {top.map((item) => (
            <RankedItemCard key={item.id} item={item} compact />
          ))}
        </View>
      ) : (
        <Txt variant="small" color={colors.textSecondary} testID="home-no-shortlist">
          {t('analysis.noQualifying')}
        </Txt>
      )}

      <SectionHeader title={t('home.favoriteCompetitions')} />
      {favorites.length === 0 ? (
        <Txt variant="small" color={colors.textSecondary}>
          {t('home.noFavorites')}
        </Txt>
      ) : (
        <Row style={{ flexWrap: 'wrap' }}>
          {favorites.map((code) => {
            const c = getCompetition(code);
            return c ? (
              <Chip
                key={code}
                label={`${c.country.flag} ${c.name[lang]}`}
                onPress={() => {
                  setUi({ competitions: [code] });
                  router.navigate('/matches');
                }}
              />
            ) : null;
          })}
        </Row>
      )}

      {rg ? (
        <View style={{ marginTop: space.lg }}>
          <Banner tone="neutral" icon="shield-checkmark-outline" text={`${t('rg.reminder')} ${t('rg.adultsOnly')}`} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, paddingVertical: 10, fontSize: 15 },
});
