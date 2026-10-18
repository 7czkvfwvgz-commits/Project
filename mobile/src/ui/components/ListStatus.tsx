import { View } from 'react-native';
import type { ProviderId } from '@/domain/types';
import { useT } from '@/hooks/useT';
import type { AggregatedFixtures, ProviderReport } from '@/providers/aggregate';
import { agoText, dateTimeText } from '../format';
import { colors, space } from '../theme';
import { Row, Txt } from './primitives';
import { Banner, StateView } from './states';

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openfootball: 'openfootball',
  'football-data': 'football-data.org',
  'the-odds-api': 'The Odds API',
  manual: 'manual',
  demo: 'demo',
};

/** Banners shown above a non-empty list (partial data, stale cache, unconfigured sources). */
export function ListBanners({ data, zone }: { data: AggregatedFixtures; zone: string }) {
  const { t } = useT();
  const banners: React.ReactNode[] = [];
  if (data.state === 'stale' && data.fetchedAt) banners.push(<Banner key="stale" tone="warning" icon="time" text={t('list.staleCache', { time: dateTimeText(data.fetchedAt, zone) })} />);
  if (data.state === 'partial') banners.push(<Banner key="partial" tone="warning" text={t('list.partial')} />);
  return banners.length ? <View style={{ gap: space.sm }}>{banners}</View> : null;
}

/** Full-screen message for an empty list — each cause has its own wording. */
export function EmptyListState({ data, onRetry, filtered }: { data: AggregatedFixtures; onRetry: () => void; filtered: boolean }) {
  const { t } = useT();
  if (filtered && data.fixtures.length > 0) return <StateView icon="filter" title={t('list.noMatchesFiltered')} testID="state-filtered" />;
  switch (data.state) {
    case 'rate_limited':
      return <StateView icon="speedometer" tone="warning" title={t('error.rate_limited')} message={t('list.rateLimited', { s: data.retryAfterSec ?? 60 })} actionLabel={t('common.retry')} onAction={onRetry} testID="state-rate-limited" />;
    case 'api_failure':
      return <StateView icon="cloud-offline" tone="danger" title={t('error.network')} message={t('list.apiFailure')} actionLabel={t('common.retry')} onAction={onRetry} testID="state-api-failure" />;
    case 'missing_credentials':
      return <StateView icon="key" tone="info" title={t('error.missing_credentials')} message={t('list.missingCredentials', { provider: 'football-data.org' })} testID="state-missing-credentials" />;
    case 'no_coverage':
      return <StateView icon="calendar-clear-outline" title={t('list.noCoverage')} testID="state-no-coverage" />;
    default:
      return <StateView icon="football-outline" title={t('list.noMatches')} actionLabel={t('common.retry')} onAction={onRetry} testID="state-no-matches" />;
  }
}

function reportText(r: ProviderReport, t: ReturnType<typeof useT>['t'], lang: ReturnType<typeof useT>['lang']): string {
  const name = PROVIDER_LABEL[r.provider];
  if (r.status === 'not_configured') return `${name}: ${t('prov.notConfigured')}`;
  if (r.status === 'error') return `${name}: ${t(`error.${r.error?.kind ?? 'unknown'}` as 'error.unknown')}`;
  const fresh = r.meta ? `${t(`fresh.${r.meta.stale ? 'stale' : r.meta.freshness}` as 'fresh.cached')} • ${t('common.updated', { ago: agoText(r.meta.fetchedAt, lang) })}` : '';
  return `${name}: ${t('list.matchesCount', { n: r.count })}${fresh ? ` • ${fresh}` : ''}`;
}

/** Source attribution and freshness for every provider consulted. */
export function SourceFooter({ data }: { data: AggregatedFixtures }) {
  const { t, lang } = useT();
  return (
    <View style={{ gap: 2, paddingVertical: space.md }} testID="source-footer">
      {data.reports.map((r) => (
        <Row key={r.provider} gap={6}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: r.status === 'ok' || r.status === 'empty' ? colors.accent : r.status === 'error' ? colors.danger : colors.neutral }} />
          <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
            {reportText(r, t, lang)}
          </Txt>
        </Row>
      ))}
    </View>
  );
}
