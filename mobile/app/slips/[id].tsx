import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, View } from 'react-native';
import { deleteSlip, setLegOutcome } from '@/db/repos';
import { parseSelectionKey, type Outcome } from '@/engine/settlement';
import { settleSlip } from '@/engine/slip';
import { useSlips } from '@/hooks/queries';
import { useT } from '@/hooks/useT';
import { fullSelectionLabel } from '@/i18n';
import { getServices } from '@/services/app';
import { useSettings } from '@/state/settings';
import { Button, Card, Chip, KeyValue, Pill, Row, Txt } from '@/ui/components/primitives';
import { Banner, StateView } from '@/ui/components/states';
import { dateTimeText, oddsText, pct } from '@/ui/format';
import { colors, space } from '@/ui/theme';

const OUTCOMES: Outcome[] = ['win', 'half_win', 'push', 'half_loss', 'loss'];

export default function SavedSlipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const slips = useSlips();
  const client = useQueryClient();
  const slip = (slips.data ?? []).find((s) => String(s.id) === String(id));
  if (!slip) return <StateView icon="receipt-outline" title={t('saved.noSlips')} />;
  const result = settleSlip(slip.legs, slip.stake);

  const setOutcome = async (legId: number, outcome: Outcome | null) => {
    const s = await getServices();
    await setLegOutcome(s.db, legId, outcome, 'manual');
    await client.invalidateQueries({ queryKey: ['slips'] });
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
      <Banner tone="neutral" icon="shield-checkmark-outline" text={t('slip.disclaimer')} />
      <Card>
        <Txt variant="h2">{slip.name}</Txt>
        <Txt variant="caption" color={colors.textMuted}>
          {dateTimeText(slip.created_at, zone)}
        </Txt>
        <KeyValue label={t('slip.stake')} value={String(slip.stake)} />
        <KeyValue label={t('slip.combinedOdds')} value={oddsText(slip.combined_odds)} />
        <KeyValue label={t('slip.combinedProbability')} value={slip.combined_probability !== null ? pct(slip.combined_probability, 1) : t('slip.unavailableCorrelation')} />
        <KeyValue label={t('slip.statusLabel')} value={t(`slip.status.${result.status}`)} hint={result.returnAmount !== null ? t('slip.return', { amount: result.returnAmount.toFixed(2) }) : undefined} />
      </Card>
      {slip.legs.map((l) => {
        const sel = parseSelectionKey(l.selectionKey);
        return (
          <Card key={l.id}>
            <Row>
              <Txt variant="bodyStrong" style={{ flex: 1 }}>
                {l.home} – {l.away}
              </Txt>
              <Pill label={l.outcome ? t(`outcome.${l.outcome}`) : t('outcome.pending')} color={l.outcome === 'win' || l.outcome === 'half_win' ? colors.accent : l.outcome ? colors.danger : colors.neutral} />
            </Row>
            <Txt variant="small">{sel ? fullSelectionLabel(lang, sel, l.home, l.away) : l.selectionKey}</Txt>
            <Txt variant="caption" color={colors.textMuted}>
              {t('common.odds')} {oddsText(l.odds)} • {t('common.probability')} {pct(l.probability)}
              {l.outcomeSource ? ` • ${l.outcomeSource === 'manual' ? t('slip.settledManually') : t('slip.settledBySource')}` : ''}
            </Txt>
            <Txt variant="caption" color={colors.textMuted}>
              {t('slip.recordOutcome')}:
            </Txt>
            <Row style={{ flexWrap: 'wrap' }}>
              {OUTCOMES.map((o) => (
                <Chip key={o} label={t(`outcome.${o}`)} selected={l.outcome === o} onPress={() => setOutcome(l.id, l.outcome === o ? null : o)} />
              ))}
            </Row>
          </Card>
        );
      })}
      <Button
        label={t('common.delete')}
        kind="danger"
        icon="trash-outline"
        onPress={() =>
          Alert.alert(t('common.delete'), slip.name, [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: async () => {
                await deleteSlip((await getServices()).db, slip.id);
                await client.invalidateQueries({ queryKey: ['slips'] });
                router.back();
              },
            },
          ])
        }
      />
      <View />
    </ScrollView>
  );
}
