import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { getCompetition } from '@/config/competitions';
import { stripDiacritics } from '@/domain/teams';
import type { Fixture, MatchStatus } from '@/domain/types';
import { useFixtureRange, useShortlist } from '@/hooks/queries';
import { useSelectedDate } from '@/hooks/useSelectedDate';
import { useT } from '@/hooks/useT';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { localDateKey } from '@/time/tz';
import { DateBar } from '@/ui/components/DateBar';
import { EmptyListState, ListBanners, SourceFooter } from '@/ui/components/ListStatus';
import { MatchCard } from '@/ui/components/MatchCard';
import { Chip, Icon, Row, Txt } from '@/ui/components/primitives';
import { DemoBanner, ListSkeleton, OfflineBanner, StateView } from '@/ui/components/states';
import { longDate } from '@/ui/format';
import { colors, radius, space } from '@/ui/theme';

const STATUS_FILTERS: MatchStatus[] = ['scheduled', 'live', 'finished', 'postponed', 'cancelled', 'no_result'];

function normalise(s: string) {
  return stripDiacritics(s).toLowerCase();
}

export default function MatchesScreen() {
  const { t, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const demo = useSettings((s) => s.demoMode);
  const compact = useSettings((s) => s.compactCards);
  const ui = useUi();
  const [date, setDate] = useSelectedDate();
  const [showFilters, setShowFilters] = useState(false);
  const rangeEnd = ui.rangeEnd;
  const to = rangeEnd ?? date;
  const query = useFixtureRange(date, to);
  // Probabilities for single-day lists; the fixture query above is shared, not repeated.
  const { shortlist } = useShortlist(date);
  const data = query.data;

  const probabilities = useMemo(() => {
    const map = new Map<string, { h: number; d: number; a: number; uncertain: boolean }>();
    if (rangeEnd) return map;
    for (const input of shortlist.data?.inputs ?? []) {
      const r = input.prediction.book.result.selections;
      const p = (k: string) => r.find((s) => s.key === k)?.probability ?? 0;
      map.set(input.fixture.id, { h: p('1X2:H'), d: p('1X2:D'), a: p('1X2:A'), uncertain: input.prediction.confidence.level === 'low' });
    }
    return map;
  }, [shortlist.data, rangeEnd]);

  const all = useMemo(() => data?.fixtures ?? [], [data]);
  const competitionsPresent = useMemo(() => [...new Set(all.map((f) => f.competition))], [all]);
  const countriesPresent = useMemo(() => [...new Set(all.map((f) => getCompetition(f.competition)?.country.code).filter(Boolean))] as string[], [all]);

  const filtered = useMemo(() => {
    const q = normalise(ui.search.trim());
    return all.filter((f) => {
      if (ui.competitions.length && !ui.competitions.includes(f.competition)) return false;
      const country = getCompetition(f.competition)?.country.code;
      if (ui.countries.length && (!country || !ui.countries.includes(country))) return false;
      if (ui.statuses.length && !ui.statuses.includes(f.status)) return false;
      if (q && !normalise(`${f.home.name} ${f.away.name}`).includes(q)) return false;
      return true;
    });
  }, [all, ui.search, ui.competitions, ui.countries, ui.statuses]);

  const sections = useMemo(() => {
    const groups = new Map<string, Fixture[]>();
    for (const f of filtered) {
      const day = f.kickoffUtc !== null ? localDateKey(f.kickoffUtc, zone) : f.sourceDate;
      const key = rangeEnd ? day : f.competition;
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    return [...groups.entries()].map(([key, items]) => {
      const comp = getCompetition(key);
      const title = rangeEnd ? longDate(key, lang) : comp ? `${comp.country.flag} ${comp.name[lang]}` : key;
      return { key, title, data: items };
    });
  }, [filtered, rangeEnd, zone, lang]);

  const activeFilters = ui.competitions.length + ui.countries.length + ui.statuses.length;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const header = (
    <View style={{ gap: space.sm, paddingBottom: space.sm }}>
      {demo ? <DemoBanner /> : null}
      <OfflineBanner />
      <DateBar date={date} zone={zone} onChange={setDate} rangeEnd={rangeEnd} onRangeChange={(end) => ui.set({ rangeEnd: end })} />
      <Row>
        <Row style={styles.search}>
          <Icon name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={ui.search}
            onChangeText={(v) => ui.set({ search: v })}
            placeholder={t('list.searchTeam')}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            clearButtonMode="while-editing"
            accessibilityLabel={t('common.search')}
            testID="matches-search"
          />
        </Row>
        <Chip label={activeFilters ? `${t('common.filters')} (${activeFilters})` : t('common.filters')} icon="options" selected={showFilters || activeFilters > 0} onPress={() => setShowFilters((v) => !v)} testID="filters-toggle" />
      </Row>
      {showFilters ? (
        <View style={styles.filters} testID="filters-panel">
          <Txt variant="caption" color={colors.textMuted}>
            {t('list.competitionFilter')}
          </Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {competitionsPresent.map((c) => {
              const comp = getCompetition(c);
              return <Chip key={c} label={comp ? `${comp.country.flag} ${comp.name[lang]}` : c} selected={ui.competitions.includes(c)} onPress={() => ui.set({ competitions: toggle(ui.competitions, c) })} />;
            })}
          </ScrollView>
          <Txt variant="caption" color={colors.textMuted}>
            {t('list.countryFilter')}
          </Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
            {countriesPresent.map((code) => {
              const country = all.map((f) => getCompetition(f.competition)?.country).find((c) => c?.code === code);
              return <Chip key={code} label={`${country?.flag ?? ''} ${country?.[lang] ?? code}`} selected={ui.countries.includes(code)} onPress={() => ui.set({ countries: toggle(ui.countries, code) })} />;
            })}
          </ScrollView>
          <Txt variant="caption" color={colors.textMuted}>
            {t('list.statusFilter')}
          </Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {STATUS_FILTERS.map((s) => (
              <Chip key={s} label={t(`status.${s}`)} selected={ui.statuses.includes(s)} onPress={() => ui.set({ statuses: toggle(ui.statuses, s) })} />
            ))}
          </Row>
          {activeFilters ? <Chip label={t('common.clear')} icon="close" onPress={() => ui.set({ competitions: [], countries: [], statuses: [] })} /> : null}
        </View>
      ) : null}
      {data ? <ListBanners data={data} zone={zone} /> : null}
      {data && filtered.length > 0 ? (
        <Txt variant="caption" color={colors.textMuted}>
          {t('list.matchesCount', { n: filtered.length })}
        </Txt>
      ) : null}
    </View>
  );

  return (
    <SectionList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}
      sections={sections}
      keyExtractor={(f) => f.id}
      renderItem={({ item }) => (
        <View style={{ marginBottom: space.sm }}>
          <MatchCard fixture={item} zone={zone} probabilities={probabilities.get(item.id)} showCompetition={!!rangeEnd} compact={compact} />
        </View>
      )}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Txt variant="h2" accessibilityRole="header">
            {section.title}
          </Txt>
        </View>
      )}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      ListEmptyComponent={
        query.isLoading ? (
          <ListSkeleton count={5} />
        ) : query.isError ? (
          <StateView icon="cloud-offline" tone="danger" title={t('error.network')} message={t('list.apiFailure')} actionLabel={t('common.retry')} onAction={() => query.refresh()} />
        ) : data ? (
          <EmptyListState data={data} onRetry={() => query.refresh()} filtered={filtered.length === 0 && all.length > 0} />
        ) : null
      }
      ListFooterComponent={data ? <SourceFooter data={data} /> : null}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refresh()} tintColor={colors.accent} />}
      initialNumToRender={10}
      windowSize={7}
      removeClippedSubviews
      testID="matches-list"
    />
  );
}

const styles = StyleSheet.create({
  search: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, paddingVertical: 9, fontSize: 15 },
  filters: { gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
  sectionHeader: { paddingTop: space.md, paddingBottom: space.sm, backgroundColor: colors.bg },
});

