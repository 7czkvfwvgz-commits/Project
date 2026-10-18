import { router } from 'expo-router';
import { memo } from 'react';
import { View } from 'react-native';
import { getCompetition } from '@/config/competitions';
import type { RankedItem } from '@/engine/ranking';
import { useT } from '@/hooks/useT';
import { fullSelectionLabel } from '@/i18n';
import { useSettings } from '@/state/settings';
import { kickoffText, oddsText, pct } from '../format';
import { colors, space } from '../theme';
import { Card, Icon, Row, Txt } from './primitives';
import { ConfidenceBadge, EvBadge, ProbBar, QualityBadge } from './probability';

export const RankedItemCard = memo(function RankedItemCard({ item, compact }: { item: RankedItem; compact?: boolean }) {
  const { t, tm, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const hideBetting = useSettings((s) => s.hideBetting);
  const showFair = useSettings((s) => s.showFairOdds);
  const { fixture, estimate, confidence, prediction } = item;
  const comp = getCompetition(fixture.competition);
  const label = fullSelectionLabel(lang, estimate.selection, fixture.home.short, fixture.away.short);
  return (
    <Card onPress={() => router.push({ pathname: '/match/[id]', params: { id: fixture.id } })} accessibilityLabel={`${fixture.home.short} – ${fixture.away.short}. ${label}: ${pct(estimate.probability)}`}>
      <Row>
        <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }} numberOfLines={1}>
          {comp?.country.flag} {comp?.name[lang]} • {kickoffText(fixture, zone)}
        </Txt>
      </Row>
      <Txt variant="bodyStrong" numberOfLines={1}>
        {fixture.home.short} – {fixture.away.short}
      </Txt>
      <ProbBar label={label} p={estimate.probability} uncertain={confidence.level === 'low'} right={showFair ? oddsText(1 / estimate.probability) : undefined} />
      <Row style={{ flexWrap: 'wrap' }} gap={6}>
        <ConfidenceBadge confidence={confidence} />
        <QualityBadge quality={prediction.quality} />
        {!hideBetting ? item.quote ? <EvBadge ev={item.ev} /> : null : null}
      </Row>
      {!hideBetting && item.quote ? (
        <Txt variant="caption" color={colors.textSecondary}>
          {t('common.odds')} {oddsText(item.quote.decimal)} • {item.quote.provider === 'manual' ? t('odds.manual') : item.quote.bookmaker} • {t('metric.implied')} {pct(item.implied)}
        </Txt>
      ) : null}
      {!compact ? (
        <View style={{ gap: 4 }}>
          <Txt variant="caption" color={colors.textMuted}>
            {t('analysis.why')}
          </Txt>
          {item.reasons.map((r, i) => (
            <Row key={i} gap={6} style={{ alignItems: 'flex-start' }}>
              <Icon name="checkmark-circle-outline" size={14} color={colors.textSecondary} style={{ marginTop: 2 }} />
              <Txt variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                {tm(r)}
              </Txt>
            </Row>
          ))}
        </View>
      ) : null}
      <Row gap={6} style={{ alignItems: 'flex-start', paddingTop: space.xs }}>
        <Icon name="alert-circle-outline" size={14} color={colors.warning} style={{ marginTop: 2 }} />
        <Txt variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
          <Txt variant="small" color={colors.warning}>
            {t('analysis.counter')}:{' '}
          </Txt>
          {tm(item.counter)}
        </Txt>
      </Row>
    </Card>
  );
});
