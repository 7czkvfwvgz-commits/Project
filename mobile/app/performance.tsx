import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { getCompetition } from '@/config/competitions';
import { SMALL_SAMPLE, type CalibrationBin } from '@/engine/metrics';
import { computePerformance } from '@/engine/performance';
import { BACKTEST } from '@/engine/validation';
import { usePredictions } from '@/hooks/queries';
import { useT } from '@/hooks/useT';
import { useSettings } from '@/state/settings';
import { CalibrationChart, CalibrationTable } from '@/ui/components/charts';
import { Card, KeyValue, Row, SectionHeader, Txt } from '@/ui/components/primitives';
import { Banner, ListSkeleton, StateView } from '@/ui/components/states';
import { pct } from '@/ui/format';
import { colors, space } from '@/ui/theme';

const f4 = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : '—');

function backtestBins(raw: { lower: number; upper: number; count: number; meanPredicted: number | null; observed: number | null; ciLow: number; ciHigh: number }[]): CalibrationBin[] {
  return raw.map((b) => ({ ...b, meanPredicted: b.meanPredicted ?? Number.NaN, observed: b.observed ?? Number.NaN }));
}

export default function PerformanceScreen() {
  const { t, lang } = useT();
  const hideBetting = useSettings((s) => s.hideBetting);
  const predictions = usePredictions();
  const perf = useMemo(() => computePerformance(predictions.data ?? []), [predictions.data]);
  const bt = BACKTEST;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} testID="performance-screen">
      <SectionHeader title={t('perf.yourPredictions')} />
      {predictions.isLoading ? (
        <ListSkeleton count={2} />
      ) : perf.totalRows === 0 ? (
        <StateView icon="analytics-outline" title={t('perf.empty')} message={t('saved.noPredictions')} />
      ) : (
        <>
          {perf.evaluated < SMALL_SAMPLE ? <Banner tone="warning" text={t('perf.smallSample', { n: perf.evaluated })} /> : null}
          <Card>
            <KeyValue label={t('perf.total')} value={`${perf.totalSnapshots} (${perf.totalRows})`} />
            <KeyValue label={t('perf.settled')} value={String(perf.settledRows)} />
            <KeyValue label={t('perf.hitRate')} value={pct(perf.hitRate, 1)} hint={t('common.sampleSize', { n: perf.evaluated })} />
            <KeyValue label={t('perf.brier')} value={f4(perf.brier)} />
            <KeyValue label={t('perf.logLoss')} value={f4(perf.logLoss)} />
            <KeyValue label={t('perf.rps')} value={f4(perf.rps1x2)} hint={t('common.sampleSize', { n: perf.rpsMatches })} />
          </Card>
          {perf.evaluated > 0 ? (
            <Card>
              <Txt variant="bodyStrong">{t('perf.calibration')}</Txt>
              <Txt variant="caption" color={colors.textMuted}>
                {t('perf.calibrationHint')}
              </Txt>
              <CalibrationTable bins={perf.calibration} />
            </Card>
          ) : null}
          {perf.byMarket.length ? (
            <Card>
              <Txt variant="bodyStrong">{t('perf.byMarket')}</Txt>
              {perf.byMarket.map((g) => (
                <KeyValue key={g.key} label={g.key} value={`${pct(g.hitRate)} / ${pct(g.meanProbability)}`} hint={`n=${g.n} • Brier ${f4(g.brier)}`} />
              ))}
            </Card>
          ) : null}
          {perf.byCompetition.length ? (
            <Card>
              <Txt variant="bodyStrong">{t('perf.byCompetition')}</Txt>
              {perf.byCompetition.map((g) => (
                <KeyValue key={g.key} label={getCompetition(g.key)?.name[lang] ?? g.key} value={`${pct(g.hitRate)} / ${pct(g.meanProbability)}`} hint={`n=${g.n} • Brier ${f4(g.brier)}`} />
              ))}
            </Card>
          ) : null}
          {!hideBetting ? (
            <Card>
              <Txt variant="bodyStrong">{t('perf.pnl')}</Txt>
              {perf.pnl ? (
                <>
                  <KeyValue label={t('perf.matches')} value={String(perf.pnl.bets)} />
                  <KeyValue label="P/L" value={perf.pnl.profit.toFixed(2)} hint={`ROI ${pct(perf.pnl.roi, 1)}`} />
                  <Txt variant="caption" color={colors.warning}>
                    {t('perf.noProfitClaim')}
                  </Txt>
                </>
              ) : (
                <Txt variant="small" color={colors.textMuted}>
                  {t('perf.pnlNone')}
                </Txt>
              )}
            </Card>
          ) : null}
        </>
      )}

      <SectionHeader title={t('perf.backtest')} />
      <Card testID="backtest-card">
        <Txt variant="caption" color={colors.textMuted}>
          {t('perf.backtestHint', { tune: bt.tuneSeasons.join(', '), test: bt.testSeason })}
        </Txt>
        <Txt variant="caption" color={colors.textMuted}>
          {bt.modelVersion} • {bt.leagues.map((c) => getCompetition(c)?.name[lang] ?? c).join(', ')} • {bt.source}
        </Txt>
        <Row>
          <Txt variant="caption" color={colors.textMuted} style={{ flex: 2 }} />
          <Txt variant="caption" color={colors.textMuted} style={{ flex: 1, textAlign: 'right' }}>
            {t('perf.model')}
          </Txt>
          <Txt variant="caption" color={colors.textMuted} style={{ flex: 1, textAlign: 'right' }}>
            {t('perf.baseline')}
          </Txt>
        </Row>
        {(
          [
            [`${t('perf.rps')}`, bt.test.rps, bt.test.rpsBaseline],
            [`${t('perf.logLoss')} 1X2`, bt.test.logLoss1x2, bt.test.logLoss1x2Baseline],
            [`${t('perf.brier')} 1X2`, bt.test.brier1x2, bt.test.brier1x2Baseline],
            [`${t('perf.logLoss')} ${t('sel.over', { line: 2.5 })}`, bt.test.over25.logLoss, bt.test.over25.logLossBaseline],
            [`${t('perf.logLoss')} ${t('group.btts')}`, bt.test.btts.logLoss, bt.test.btts.logLossBaseline],
            [`${t('perf.logLoss')} ${t('market.HT_1X2')}`, bt.test.halfTime1x2?.logLoss ?? NaN, bt.test.halfTime1x2?.logLossBaseline ?? NaN],
          ] as [string, number, number][]
        ).map(([label, model, base]) => (
          <Row key={label}>
            <Txt variant="small" color={colors.textSecondary} style={{ flex: 2 }}>
              {label}
            </Txt>
            <Txt variant="number" style={{ flex: 1, textAlign: 'right' }} color={model < base ? colors.accent : colors.text}>
              {f4(model)}
            </Txt>
            <Txt variant="number" style={{ flex: 1, textAlign: 'right' }} color={colors.textSecondary}>
              {f4(base)}
            </Txt>
          </Row>
        ))}
        <Txt variant="caption" color={colors.textMuted}>
          {t('perf.matches')}: {bt.test.matches} • {t('perf.hitRate')} 1X2: {pct(bt.test.accuracy1x2, 1)}
        </Txt>
      </Card>
      <Card>
        <Txt variant="bodyStrong">
          {t('perf.calibration')} — 1X2 (ECE {bt.calibration.result1x2.ece})
        </Txt>
        <CalibrationChart bins={backtestBins(bt.calibration.result1x2.bins)} />
        <CalibrationTable bins={backtestBins(bt.calibration.result1x2.bins)} />
      </Card>
      <Card>
        <Txt variant="bodyStrong">
          {t('perf.calibration')} — {t('sel.over', { line: 2.5 })} (ECE {bt.calibration.over25.ece})
        </Txt>
        <CalibrationChart bins={backtestBins(bt.calibration.over25.bins)} />
        <CalibrationTable bins={backtestBins(bt.calibration.over25.bins)} />
      </Card>
      <Txt variant="caption" color={colors.textMuted}>
        {t('perf.notCalibratedClaim')} {t('perf.noProfitClaim')}
      </Txt>
      <View />
    </ScrollView>
  );
}
