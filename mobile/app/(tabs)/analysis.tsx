import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { getCompetition } from '@/config/competitions';
import type { Grade, Level } from '@/engine/assessment';
import { rankSelections, RANKING_KINDS, type RankingKind, type RankingSort } from '@/engine/ranking';
import type { MarketKey } from '@/engine/settlement';
import { useShortlist } from '@/hooks/queries';
import { useNow } from '@/hooks/useNow';
import { useSelectedDate } from '@/hooks/useSelectedDate';
import { useT } from '@/hooks/useT';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { DateBar } from '@/ui/components/DateBar';
import { EmptyListState } from '@/ui/components/ListStatus';
import { Card, Chip, Icon, Row, Txt } from '@/ui/components/primitives';
import { RankedItemCard } from '@/ui/components/RankedItemCard';
import { Banner, DemoBanner, ListSkeleton, OfflineBanner, StateView } from '@/ui/components/states';
import { colors, radius, space } from '@/ui/theme';

const MIN_PROBS = [0, 0.5, 0.6, 0.7, 0.8];
const GRADES: (Grade | null)[] = [null, 'C', 'B', 'A'];
const LEVELS: (Level | null)[] = [null, 'medium', 'high'];
const MARKETS: MarketKey[] = ['1X2', 'DC', 'OU', 'BTTS'];
const SORTS: RankingSort[] = ['probability', 'ev', 'kickoff', 'confidence'];

export default function AnalysisScreen() {
  const { t, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const demo = useSettings((s) => s.demoMode);
  const hideBetting = useSettings((s) => s.hideBetting);
  const lastViewed = useSettings((s) => s.lastViewedFixtureId);
  const ui = useUi();
  const [date, setDate] = useSelectedDate();
  const [showFilters, setShowFilters] = useState(false);
  const { fixtures, shortlist } = useShortlist(date);
  const now = useNow();
  const f = ui.rankingFilters;
  const kinds = hideBetting ? RANKING_KINDS.filter((k) => k !== 'positive_ev') : RANKING_KINDS;
  const kind: RankingKind = kinds.includes(ui.rankingKind) ? ui.rankingKind : 'top_probability';

  const items = useMemo(
    () => (shortlist.data ? rankSelections(shortlist.data.inputs, kind, f, hideBetting && ui.rankingSort === 'ev' ? 'probability' : ui.rankingSort, now) : []),
    [shortlist.data, kind, f, ui.rankingSort, hideBetting, now],
  );
  const anyOdds = (shortlist.data?.inputs ?? []).some((i) => i.quotes.length > 0);
  const comps = useMemo(() => [...new Set((shortlist.data?.inputs ?? []).map((i) => i.fixture.competition))], [shortlist.data]);
  const setFilters = (patch: Partial<typeof f>) => ui.set({ rankingFilters: { ...f, ...patch } });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const header = (
    <View style={{ gap: space.sm, paddingBottom: space.sm }}>
      {demo ? <DemoBanner /> : null}
      <OfflineBanner />
      <DateBar date={date} zone={zone} onChange={setDate} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {kinds.map((k) => (
          <Chip key={k} label={t(`ranking.${k}`)} selected={k === kind} onPress={() => ui.set({ rankingKind: k })} testID={`ranking-${k}`} />
        ))}
      </ScrollView>
      <Row>
        <Txt variant="caption" color={colors.textMuted}>
          {t('analysis.sort')}:
        </Txt>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {SORTS.filter((s) => !(hideBetting && s === 'ev')).map((s) => (
            <Chip key={s} label={t(`analysis.sort.${s}`)} selected={ui.rankingSort === s} onPress={() => ui.set({ rankingSort: s })} />
          ))}
          <Chip label={t('common.filters')} icon="options" selected={showFilters} onPress={() => setShowFilters((v) => !v)} />
        </ScrollView>
      </Row>
      {showFilters ? (
        <View style={styles.filters}>
          <Txt variant="caption" color={colors.textMuted}>
            {t('analysis.minProbability')}
          </Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {MIN_PROBS.map((p) => (
              <Chip key={p} label={p === 0 ? t('common.all') : `≥ ${p * 100}%`} selected={f.minProbability === p} onPress={() => setFilters({ minProbability: p })} />
            ))}
          </Row>
          <Txt variant="caption" color={colors.textMuted}>
            {t('analysis.minQuality')}
          </Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {GRADES.map((g) => (
              <Chip key={g ?? 'any'} label={g ? `≥ ${g}` : t('common.all')} selected={f.minGrade === g} onPress={() => setFilters({ minGrade: g })} />
            ))}
          </Row>
          <Txt variant="caption" color={colors.textMuted}>
            {t('analysis.minConfidence')}
          </Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {LEVELS.map((l) => (
              <Chip key={l ?? 'any'} label={l ? `≥ ${t(`level.${l}`)}` : t('common.all')} selected={f.minConfidence === l} onPress={() => setFilters({ minConfidence: l })} />
            ))}
          </Row>
          {!hideBetting ? (
            <>
              <Txt variant="caption" color={colors.textMuted}>
                {t('analysis.minEv')}
              </Txt>
              <Row style={{ flexWrap: 'wrap' }}>
                {[null, 0, 0.05].map((v) => (
                  <Chip key={String(v)} label={v === null ? t('common.all') : `≥ ${v * 100}%`} selected={f.minEv === v} onPress={() => setFilters({ minEv: v })} />
                ))}
              </Row>
            </>
          ) : null}
          <Txt variant="caption" color={colors.textMuted}>
            {t('analysis.market')}
          </Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {MARKETS.map((m) => (
              <Chip key={m} label={t(`market.${m}`)} selected={f.markets.includes(m)} onPress={() => setFilters({ markets: toggle(f.markets, m) })} />
            ))}
          </Row>
          <Txt variant="caption" color={colors.textMuted}>
            {t('list.competitionFilter')}
          </Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {comps.map((c) => {
              const comp = getCompetition(c);
              return <Chip key={c} label={comp ? `${comp.country.flag} ${comp.name[lang]}` : c} selected={f.competitions.includes(c)} onPress={() => setFilters({ competitions: toggle(f.competitions, c) })} />;
            })}
          </Row>
          <Txt variant="caption" color={colors.textMuted}>
            {t('list.countryFilter')}
          </Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {[...new Set(comps.map((c) => getCompetition(c)?.country.code))].filter(Boolean).map((code) => {
              const country = comps.map((c) => getCompetition(c)?.country).find((x) => x?.code === code);
              return (
                <Chip
                  key={code}
                  label={`${country?.flag ?? ''} ${country?.[lang] ?? code}`}
                  selected={f.countries.includes(code as string)}
                  onPress={() => setFilters({ countries: toggle(f.countries, code as string) })}
                />
              );
            })}
          </Row>
        </View>
      ) : null}
      <Banner tone="neutral" icon="information-circle-outline" text={`${t('analysis.disclaimer')} ${t('metric.distinctHint')}`} />
      {kind === 'positive_ev' && shortlist.data && !anyOdds ? <Banner tone="info" icon="pricetags-outline" text={t('analysis.noOdds')} /> : null}
      {lastViewed ? (
        <Card onPress={() => router.push({ pathname: '/match/[id]', params: { id: lastViewed } })}>
          <Row>
            <Icon name="time-outline" size={16} color={colors.textSecondary} />
            <Txt variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
              {t('analysis.lastViewed')}
            </Txt>
            <Icon name="chevron-forward" size={16} color={colors.textSecondary} />
          </Row>
        </Card>
      ) : null}
    </View>
  );

  const loading = fixtures.isLoading || (fixtures.isSuccess && shortlist.isPending);

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }}
      data={loading ? [] : items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => (
        <View style={{ marginBottom: space.sm }}>
          <RankedItemCard item={item} />
        </View>
      )}
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading ? (
          <View style={{ gap: space.sm }}>
            <Txt variant="caption" color={colors.textMuted}>
              {t('analysis.computing')}
            </Txt>
            <ListSkeleton count={3} />
          </View>
        ) : fixtures.isError || shortlist.isError ? (
          <StateView icon="cloud-offline" tone="danger" title={t('error.network')} message={t('list.apiFailure')} actionLabel={t('common.retry')} onAction={() => fixtures.refresh()} />
        ) : fixtures.data && fixtures.data.fixtures.length === 0 ? (
          <EmptyListState data={fixtures.data} onRetry={() => fixtures.refresh()} filtered={false} />
        ) : (
          <StateView icon="filter-outline" title={t('analysis.noQualifying')} testID="analysis-empty" />
        )
      }
      refreshControl={<RefreshControl refreshing={fixtures.isRefetching} onRefresh={() => fixtures.refresh()} tintColor={colors.accent} />}
      initialNumToRender={6}
      windowSize={7}
      testID="analysis-list"
    />
  );
}

const styles = StyleSheet.create({
  filters: { gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md },
});
