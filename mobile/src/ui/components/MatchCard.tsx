import { router } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { getCompetition } from '@/config/competitions';
import type { Fixture } from '@/domain/types';
import { useT } from '@/hooks/useT';
import { kickoffText } from '../format';
import { colors, space } from '../theme';
import { Card, Pill, Row, Txt } from './primitives';
import { ThreeWayBar } from './probability';

export function StatusPill({ fixture }: { fixture: Fixture }) {
  const { t } = useT();
  switch (fixture.status) {
    case 'live':
      return <Pill label={fixture.minute ? `${t('status.live')} ${fixture.minute}'` : t('status.live')} color={colors.live} background={colors.dangerSoft} />;
    case 'finished':
      return <Pill label={t('status.finished')} color={colors.textSecondary} />;
    case 'scheduled':
      return <Pill label={t('status.scheduled')} color={colors.textSecondary} />;
    case 'no_result':
      return <Pill label={t('status.no_result')} color={colors.neutral} background={colors.neutralSoft} />;
    default:
      return <Pill label={t(`status.${fixture.status}`)} color={colors.warning} background={colors.warningSoft} />;
  }
}

export interface MatchCardProps {
  fixture: Fixture;
  zone: string;
  probabilities?: { h: number; d: number; a: number; uncertain: boolean } | null;
  compact?: boolean;
  showCompetition?: boolean;
}

export const MatchCard = memo(function MatchCard({ fixture, zone, probabilities, compact, showCompetition = true }: MatchCardProps) {
  const { t, lang } = useT();
  const comp = getCompetition(fixture.competition);
  const showScore = !!fixture.ft && (fixture.status === 'finished' || fixture.status === 'live' || fixture.status === 'awarded');
  const label = `${fixture.home.short} ${t('common.vs')} ${fixture.away.short}, ${kickoffText(fixture, zone)}`;
  return (
    <Card
      onPress={() => router.push({ pathname: '/match/[id]', params: { id: fixture.id } })}
      accessibilityLabel={label}
      style={compact ? { padding: space.sm } : undefined}
    >
      <Row>
        {showCompetition && comp ? (
          <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }} numberOfLines={1}>
            {comp.country.flag} {comp.name[lang]}
          </Txt>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {fixture.isDemo ? <Pill label={t('fresh.demo')} color={colors.demo} background={colors.demoSoft} /> : null}
        <StatusPill fixture={fixture} />
      </Row>
      <Row gap={space.md}>
        <View style={styles.time}>
          <Txt variant="number" color={fixture.kickoffUtc === null ? colors.textMuted : colors.text}>
            {kickoffText(fixture, zone)}
          </Txt>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row>
            <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {fixture.home.short}
            </Txt>
            {showScore ? <Txt variant="number">{fixture.ft?.home}</Txt> : null}
          </Row>
          <Row>
            <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {fixture.away.short}
            </Txt>
            {showScore ? <Txt variant="number">{fixture.ft?.away}</Txt> : null}
          </Row>
        </View>
      </Row>
      {probabilities && fixture.status === 'scheduled' && !compact ? <ThreeWayBar compact h={probabilities.h} d={probabilities.d} a={probabilities.a} /> : null}
      {fixture.kickoffUtc === null && fixture.status === 'scheduled' ? (
        <Txt variant="caption" color={colors.textMuted}>
          {t('kickoff.dateOnly')}
        </Txt>
      ) : null}
    </Card>
  );
});

const styles = StyleSheet.create({
  time: { width: 52 },
});
