import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { saveSlip } from '@/db/repos';
import { analyzeSlip, type FixtureModel } from '@/engine/slip';
import { parseSelectionKey } from '@/engine/settlement';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/hooks/useT';
import { fullSelectionLabel } from '@/i18n';
import type { MatchAnalysis } from '@/services/analysis';
import { getServices } from '@/services/app';
import { useSettings } from '@/state/settings';
import { useSlip } from '@/state/slip';
import { Button, Card, Icon, KeyValue, Row, TextButton, Txt } from '@/ui/components/primitives';
import { Banner, StateView } from '@/ui/components/states';
import { dateTimeText, oddsText, pct } from '@/ui/format';
import { colors, radius, space } from '@/ui/theme';

export default function SlipScreen() {
  const { t, tm, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const hideBetting = useSettings((s) => s.hideBetting);
  const rg = useSettings((s) => s.rgReminders);
  const slip = useSlip();
  const client = useQueryClient();
  const [stakeText, setStakeText] = useState(String(slip.stake));

  const now = useNow();
  const analysis = useMemo(() => {
    // Scoreline models of the legs' matches, from analyses already computed on this device.
    const models = new Map<string, FixtureModel>();
    for (const [, data] of client.getQueriesData<MatchAnalysis | null>({ queryKey: ['analysis'] })) {
      if (data?.prediction) models.set(data.fixture.id, { ft: data.prediction.ft, half: data.prediction.half });
    }
    return analyzeSlip(slip.legs, slip.stake, models, now);
  }, [client, slip.legs, slip.stake, now]);

  if (hideBetting) return <StateView icon="eye-off-outline" title={t('settings.hideBettingHint')} />;

  const save = async () => {
    const s = await getServices();
    const now = Date.now();
    await saveSlip(
      s.db,
      {
        name: `${t('saved.slips')} ${dateTimeText(now, zone)}`,
        stake: slip.stake,
        combinedOdds: analysis.combinedOdds,
        combinedProbability: analysis.combinedProbability,
        probabilityMethod: analysis.probabilityMethod ?? null,
      },
      slip.legs,
      now,
    );
    await client.invalidateQueries({ queryKey: ['slips'] });
    slip.clear();
    Alert.alert(t('slip.saved'));
    router.back();
  };

  const unavailableText = {
    missing_odds: t('slip.unavailableMissingOdds'),
    same_match: t('slip.unavailableSameMatch'),
    correlation: t('slip.unavailableCorrelation'),
    non_binary: t('slip.unavailableNonBinary'),
    missing_probability: t('slip.unavailableMissingProbability'),
  } as const;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="slip-screen">
      <Banner tone="neutral" icon="shield-checkmark-outline" text={t('slip.disclaimer')} />
      {slip.legs.length === 0 ? (
        <StateView icon="receipt-outline" title={t('slip.empty')} testID="slip-empty" />
      ) : (
        <>
          {slip.legs.map((l) => {
            const sel = parseSelectionKey(l.selectionKey);
            return (
              <Card key={`${l.fixtureId}-${l.selectionKey}`}>
                <Row>
                  <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {l.home} – {l.away}
                  </Txt>
                  <TextButton label={t('slip.remove')} icon="close-circle-outline" onPress={() => slip.remove(l.fixtureId, l.selectionKey)} />
                </Row>
                <Txt variant="small">{sel ? fullSelectionLabel(lang, sel, l.home, l.away) : l.selectionKey}</Txt>
                <Row style={{ flexWrap: 'wrap' }} gap={space.md}>
                  <Txt variant="caption" color={colors.textSecondary}>
                    {t('common.probability')}: {pct(l.probability)}
                  </Txt>
                  <Txt variant="caption" color={colors.textSecondary}>
                    {t('common.odds')}: {l.odds ? `${oddsText(l.odds)} (${l.oddsProvider === 'manual' ? t('odds.manual') : l.oddsBookmaker})` : t('odds.unavailable')}
                  </Txt>
                </Row>
              </Card>
            );
          })}

          <Card>
            <Txt variant="small" color={colors.textSecondary}>
              {t('slip.stake')}
            </Txt>
            <TextInput
              value={stakeText}
              onChangeText={(v) => {
                setStakeText(v);
                const n = Number(v.replace(',', '.'));
                if (Number.isFinite(n) && n >= 0) slip.setStake(n);
              }}
              keyboardType="decimal-pad"
              style={styles.input}
              accessibilityLabel={t('slip.stake')}
              testID="slip-stake"
            />
            <KeyValue label={t('slip.combinedOdds')} value={analysis.combinedOdds !== null ? oddsText(analysis.combinedOdds) : '—'} hint={analysis.combinedOddsUnavailable ? unavailableText[analysis.combinedOddsUnavailable] : undefined} />
            <KeyValue label={t('slip.grossReturn')} value={analysis.grossReturn !== null ? analysis.grossReturn.toFixed(2) : '—'} />
            <KeyValue label={t('slip.netProfit')} value={analysis.netProfit !== null ? analysis.netProfit.toFixed(2) : '—'} />
            <KeyValue
              label={t('slip.combinedProbability')}
              value={analysis.combinedProbability !== null ? pct(analysis.combinedProbability, 1) : '—'}
              hint={
                analysis.probabilityUnavailable
                  ? unavailableText[analysis.probabilityUnavailable]
                  : analysis.probabilityMethod === 'joint_scoreline'
                    ? t('slip.methodJoint')
                    : t('slip.methodIndependent')
              }
            />
            <KeyValue label={t('slip.ev')} value={analysis.expectedValue !== null ? `${(analysis.expectedValue * 100).toFixed(1)}%` : '—'} />
          </Card>

          {analysis.warnings.map((w, i) => (
            <Banner key={`${w.key}-${i}`} tone="warning" text={tm(w)} />
          ))}

          <Row>
            <View style={{ flex: 1 }}>
              <Button label={t('slip.clear')} kind="secondary" icon="trash-outline" onPress={() => slip.clear()} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={t('slip.save')} icon="save-outline" onPress={save} testID="slip-save" />
            </View>
          </Row>
        </>
      )}
      {rg ? (
        <Row gap={6} style={{ alignItems: 'flex-start' }}>
          <Icon name="information-circle-outline" size={16} color={colors.textMuted} />
          <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
            {t('rg.reminder')} {t('rg.help')}
          </Txt>
        </Row>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  input: {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    fontSize: 20,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
