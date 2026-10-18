import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import type { CalibrationBin } from '@/engine/metrics';
import type { ScoreMatrix } from '@/engine/scoreMatrix';
import { cell } from '@/engine/scoreMatrix';
import type { FormEntry } from '@/engine/teamStats';
import { useT } from '@/hooks/useT';
import { pct } from '../format';
import { colors, radius, space } from '../theme';
import { Row, Txt } from './primitives';

/** Correct-score probabilities 0–5 as a heat grid (opacity ∝ probability). */
export function ScoreGrid({ matrix, home, away, max = 5 }: { matrix: ScoreMatrix; home: string; away: string; max?: number }) {
  const peak = Math.max(...Array.from({ length: max + 1 }, (_, h) => Array.from({ length: max + 1 }, (_, a) => cell(matrix, h, a))).flat());
  return (
    <View style={{ gap: 2 }} accessibilityLabel="score matrix">
      <Row gap={2}>
        <View style={styles.axisCell}>
          <Txt variant="caption" dense color={colors.textMuted}>
            {home.slice(0, 3)}↓ {away.slice(0, 3)}→
          </Txt>
        </View>
        {Array.from({ length: max + 1 }, (_, a) => (
          <View key={a} style={styles.headCell}>
            <Txt variant="caption" dense color={colors.textMuted}>
              {a}
            </Txt>
          </View>
        ))}
      </Row>
      {Array.from({ length: max + 1 }, (_, h) => (
        <Row key={h} gap={2}>
          <View style={styles.axisCell}>
            <Txt variant="caption" dense color={colors.textMuted}>
              {h}
            </Txt>
          </View>
          {Array.from({ length: max + 1 }, (_, a) => {
            const p = cell(matrix, h, a);
            return (
              <View key={a} style={[styles.cell, { backgroundColor: `rgba(47, 203, 126, ${Math.min(0.85, (p / peak) * 0.85).toFixed(3)})` }]}>
                <Txt variant="caption" dense color={p / peak > 0.5 ? colors.bg : colors.textSecondary}>
                  {(p * 100).toFixed(p >= 0.095 ? 0 : 1)}
                </Txt>
              </View>
            );
          })}
        </Row>
      ))}
    </View>
  );
}

/** Observed frequency (bars) against mean predicted probability (line) per probability range. */
export function CalibrationChart({ bins }: { bins: CalibrationBin[] }) {
  const { width } = useWindowDimensions();
  const { t } = useT();
  const used = bins.filter((b) => b.count > 0);
  if (used.length === 0) return null;
  const chartWidth = Math.max(220, width - 120);
  const spacing = 6;
  const barWidth = Math.max(10, chartWidth / used.length - spacing - 2);
  return (
    <View style={{ gap: space.sm }}>
      <BarChart
        data={used.map((b) => ({
          value: Math.round((b.observed || 0) * 100),
          label: `${Math.round(b.lower * 100)}`,
          frontColor: b.count < 30 ? colors.neutral : colors.accent,
        }))}
        lineData={used.map((b) => ({ value: Math.round((b.meanPredicted || 0) * 100) }))}
        showLine
        lineConfig={{ color: colors.warning, thickness: 2, dataPointsColor: colors.warning, curved: false }}
        maxValue={100}
        noOfSections={4}
        barWidth={barWidth}
        spacing={spacing}
        width={chartWidth}
        height={160}
        yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 9 }}
        rulesColor={colors.border}
        xAxisColor={colors.border}
        yAxisColor={colors.border}
        isAnimated={false}
      />
      <Row gap={space.md}>
        <Row gap={4}>
          <View style={[styles.legend, { backgroundColor: colors.accent }]} />
          <Txt variant="caption" color={colors.textSecondary}>
            {t('perf.observed')}
          </Txt>
        </Row>
        <Row gap={4}>
          <View style={[styles.legend, { backgroundColor: colors.warning }]} />
          <Txt variant="caption" color={colors.textSecondary}>
            {t('perf.predicted')}
          </Txt>
        </Row>
      </Row>
    </View>
  );
}

export function CalibrationTable({ bins }: { bins: CalibrationBin[] }) {
  const { t } = useT();
  return (
    <View style={{ gap: 2 }}>
      <Row>
        <Txt variant="caption" color={colors.textMuted} style={{ flex: 1.2 }}>
          %
        </Txt>
        <Txt variant="caption" color={colors.textMuted} style={{ flex: 1, textAlign: 'right' }}>
          n
        </Txt>
        <Txt variant="caption" color={colors.textMuted} style={{ flex: 1.2, textAlign: 'right' }}>
          {t('perf.predicted')}
        </Txt>
        <Txt variant="caption" color={colors.textMuted} style={{ flex: 2, textAlign: 'right' }}>
          {t('perf.observed')} (95%)
        </Txt>
      </Row>
      {bins
        .filter((b) => b.count > 0)
        .map((b) => (
          <Row key={b.lower}>
            <Txt variant="caption" dense style={{ flex: 1.2 }}>
              {Math.round(b.lower * 100)}–{Math.round(b.upper * 100)}
            </Txt>
            <Txt variant="caption" dense style={{ flex: 1, textAlign: 'right' }}>
              {b.count}
            </Txt>
            <Txt variant="caption" dense style={{ flex: 1.2, textAlign: 'right' }}>
              {pct(b.meanPredicted, 1)}
            </Txt>
            <Txt variant="caption" dense style={{ flex: 2, textAlign: 'right' }}>
              {pct(b.observed, 1)} ({pct(b.ciLow)}–{pct(b.ciHigh)})
            </Txt>
          </Row>
        ))}
    </View>
  );
}

/** Goals scored (up) and conceded (down) in recent matches, oldest on the left. */
export function GoalsChart({ entries }: { entries: FormEntry[] }) {
  const { width } = useWindowDimensions();
  const data = [...entries].reverse();
  if (data.length === 0) return null;
  const chartWidth = Math.max(200, width - 100);
  const barWidth = Math.max(6, chartWidth / (data.length * 2) - 6);
  return (
    <BarChart
      data={data.flatMap((e) => [
        { value: e.gf, frontColor: colors.accent, spacing: 2, label: e.venue },
        { value: e.ga, frontColor: colors.danger },
      ])}
      barWidth={barWidth}
      spacing={8}
      width={chartWidth}
      height={90}
      noOfSections={3}
      maxValue={Math.max(3, ...data.map((e) => Math.max(e.gf, e.ga)))}
      yAxisTextStyle={{ color: colors.textMuted, fontSize: 10 }}
      xAxisLabelTextStyle={{ color: colors.textMuted, fontSize: 9 }}
      rulesColor={colors.border}
      xAxisColor={colors.border}
      yAxisColor={colors.border}
      isAnimated={false}
    />
  );
}

const styles = StyleSheet.create({
  axisCell: { width: 54, alignItems: 'center', justifyContent: 'center' },
  headCell: { flex: 1, alignItems: 'center' },
  cell: { flex: 1, aspectRatio: 1.3, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  legend: { width: 10, height: 10, borderRadius: 2 },
});
