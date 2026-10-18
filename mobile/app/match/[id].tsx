import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { getCompetition } from '@/config/competitions';
import { SnapshotRejected } from '@/db/repos';
import { useFavorites, useMatchAnalysis, useRecordPrediction, useToggleFavorite } from '@/hooks/queries';
import { useT } from '@/hooks/useT';
import { useSettings } from '@/state/settings';
import { Button, Chip, Icon, Row, Txt } from '@/ui/components/primitives';
import { StatusPill } from '@/ui/components/MatchCard';
import { Banner, DemoBanner, ListSkeleton, OfflineBanner, StateView } from '@/ui/components/states';
import { dateTimeText, kickoffText, longDate } from '@/ui/format';
import { Explain } from '@/ui/match/Explain';
import { ManualOddsSheet } from '@/ui/match/ManualOddsSheet';
import { Markets } from '@/ui/match/Markets';
import { Overview } from '@/ui/match/Overview';
import { Stats } from '@/ui/match/Stats';
import { colors, space } from '@/ui/theme';
import { localDateKey } from '@/time/tz';

type Tab = 'overview' | 'markets' | 'stats' | 'explain';

/** "Matchday 9", "9. Round" or "9" from the source become "Кръг 9"; anything else is shown as published. */
function roundLabel(round: string, t: ReturnType<typeof useT>['t']): string {
  const m = /^(?:matchday|round|spieltag|jornada|giornata)?\s*(\d{1,2})\.?\s*(?:round|matchday)?$/i.exec(round.trim());
  return m ? t('match.roundNumber', { n: Number(m[1]) }) : t('match.round', { round });
}
const TABS: Tab[] = ['overview', 'markets', 'stats', 'explain'];

const SOURCE_LABEL: Record<string, string> = {
  openfootball: 'openfootball (CC0)',
  'football-data': 'football-data.org',
  demo: 'Demo',
};

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const autoRecord = useSettings((s) => s.autoRecord);
  const setSettings = useSettings((s) => s.set);
  const [tab, setTab] = useState<Tab>('overview');
  const [oddsKey, setOddsKey] = useState<string | null>(null);
  const analysis = useMatchAnalysis(String(id));
  const favorites = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const record = useRecordPrediction();
  const autoRecorded = useRef(false);
  const a = analysis.data;
  const isFav = !!a && (favorites.data ?? []).some((f) => f.id === a.fixture.id);

  useEffect(() => {
    if (id) setSettings({ lastViewedFixtureId: String(id) });
  }, [id, setSettings]);

  // Snapshot the prediction the first time an upcoming match is viewed (once per model version).
  useEffect(() => {
    if (!a?.prediction || autoRecorded.current || !autoRecord || a.fixture.isDemo || a.fixture.status !== 'scheduled') return;
    autoRecorded.current = true;
    record.mutate({ fixture: a.fixture, prediction: a.prediction, quotes: a.quotes, source: 'auto' });
  }, [a, autoRecord, record]);

  const onRecord = () => {
    if (!a?.prediction) return;
    record.mutate(
      { fixture: a.fixture, prediction: a.prediction, quotes: a.quotes, source: 'manual' },
      {
        onSuccess: (n) => Alert.alert(t('match.recordPrediction'), t('match.recorded', { n })),
        onError: (e) => Alert.alert(t('match.recordPrediction'), e instanceof SnapshotRejected && e.reason === 'started' ? t('match.recordOnlyBefore') : String(e)),
      },
    );
  };

  const header = (
    <Stack.Screen
      options={{
        headerRight: () =>
          a ? (
            <Pressable
              onPress={() => toggleFavorite.mutate({ fixture: a.fixture, favorite: !isFav })}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={isFav ? t('match.saved') : t('match.save')}
              testID="favorite-toggle"
            >
              <Icon name={isFav ? 'star' : 'star-outline'} size={22} color={isFav ? colors.warning : colors.text} />
            </Pressable>
          ) : null,
      }}
    />
  );

  if (analysis.isLoading) {
    return (
      <View style={styles.screen}>
        {header}
        <View style={{ padding: space.lg }}>
          <ListSkeleton count={3} />
        </View>
      </View>
    );
  }
  if (analysis.isError) {
    return (
      <View style={styles.screen}>
        {header}
        <StateView icon="cloud-offline" tone="danger" title={t('error.network')} message={t('list.apiFailure')} actionLabel={t('common.retry')} onAction={() => analysis.refetch()} />
      </View>
    );
  }
  if (!a) {
    return (
      <View style={styles.screen}>
        {header}
        <StateView icon="search" title={t('match.notFound')} testID="match-not-found" />
      </View>
    );
  }

  const f = a.fixture;
  const comp = getCompetition(f.competition);
  const score = f.ft && (f.status === 'finished' || f.status === 'live' || f.status === 'awarded');
  const localDay = f.kickoffUtc !== null ? localDateKey(f.kickoffUtc, zone) : f.sourceDate;

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={analysis.isRefetching} onRefresh={() => analysis.refetch()} tintColor={colors.accent} />}
        testID="match-screen"
      >
        {f.isDemo ? <DemoBanner /> : null}
        <OfflineBanner />
        <View style={styles.hero}>
          <Txt variant="caption" color={colors.textMuted} style={{ textAlign: 'center' }}>
            {comp ? `${comp.country.flag} ${comp.name[lang]}` : f.competition}
            {f.round ? ` • ${roundLabel(f.round, t)}` : ''}
          </Txt>
          <Row style={{ alignItems: 'center' }}>
            <Txt variant="h1" style={styles.team} numberOfLines={2}>
              {f.home.short}
            </Txt>
            <Txt variant="h1" color={score ? colors.text : colors.textMuted}>
              {score ? `${f.ft?.home} : ${f.ft?.away}` : 'vs'}
            </Txt>
            <Txt variant="h1" style={styles.team} numberOfLines={2}>
              {f.away.short}
            </Txt>
          </Row>
          {f.ht && score ? (
            <Txt variant="caption" color={colors.textMuted} style={{ textAlign: 'center' }}>
              {t('match.htScore', { score: `${f.ht.home}:${f.ht.away}` })}
            </Txt>
          ) : null}
          <Row style={{ justifyContent: 'center' }}>
            <Txt variant="small" color={colors.textSecondary}>
              {longDate(localDay, lang)} • {kickoffText(f, zone)}
            </Txt>
            <StatusPill fixture={f} />
          </Row>
          {f.kickoffUtc === null ? (
            <Txt variant="caption" color={colors.textMuted} style={{ textAlign: 'center' }}>
              {t('kickoff.dateOnly')}
            </Txt>
          ) : f.kickoffTimeSource === 'league_local' ? (
            <Txt variant="caption" color={colors.textMuted} style={{ textAlign: 'center' }}>
              {t('kickoff.assumedLocal')}
            </Txt>
          ) : null}
          {f.status === 'no_result' ? <Banner tone="neutral" text={t('status.noResultHint')} /> : null}
          <Txt variant="caption" color={colors.textMuted} style={{ textAlign: 'center' }}>
            {t('common.source', { source: SOURCE_LABEL[f.provider] ?? f.provider })}
            {f.statusProvider ? ` • ${t('list.statusFilter')}: ${SOURCE_LABEL[f.statusProvider] ?? f.statusProvider}` : ''}
            {a.datasetMeta ? ` • ${t('common.updatedAt', { time: dateTimeText(a.datasetMeta.fetchedAt, zone) })}` : ''}
          </Txt>
        </View>

        {a.unsupported ? (
          <StateView
            icon="analytics-outline"
            tone="info"
            title={a.unsupported === 'inconsistent' ? t('match.inconsistent') : a.unsupported === 'error' ? t('match.modelUnavailable') : t('match.noModel')}
            message={a.error?.message}
            testID="match-no-model"
          />
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
              {TABS.map((k) => (
                <Chip key={k} label={t(`match.tab.${k}`)} selected={tab === k} onPress={() => setTab(k)} testID={`tab-${k}`} />
              ))}
            </ScrollView>
            {tab === 'overview' ? <Overview analysis={a} /> : null}
            {tab === 'markets' ? <Markets analysis={a} onEnterOdds={setOddsKey} /> : null}
            {tab === 'stats' ? <Stats analysis={a} /> : null}
            {tab === 'explain' ? <Explain analysis={a} /> : null}
            {f.status === 'scheduled' && !f.isDemo && a.prediction ? (
              <Button label={t('match.recordPrediction')} kind="secondary" icon="bookmark-outline" onPress={onRecord} testID="record-prediction" />
            ) : null}
          </>
        )}
      </ScrollView>
      <ManualOddsSheet
        key={oddsKey ?? 'closed'}
        fixture={f}
        selectionKey={oddsKey}
        existing={a.quotes.find((q) => q.provider === 'manual' && q.selectionKey === oddsKey)?.decimal}
        onClose={() => setOddsKey(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  hero: { gap: space.sm, paddingVertical: space.sm },
  team: { flex: 1, textAlign: 'center' },
});
