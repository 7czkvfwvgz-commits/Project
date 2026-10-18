import { StyleSheet, View } from 'react-native';
import type { Confidence, DataQuality } from '@/engine/assessment';
import { useT } from '@/hooks/useT';
import { pct } from '../format';
import { colors, radius } from '../theme';
import { Pill, Row, Txt } from './primitives';

/** One probability as a labelled bar. Low-confidence estimates use the neutral colour, never the accent. */
export function ProbBar({ label, p, uncertain, right, testID }: { label: string; p: number; uncertain?: boolean; right?: string; testID?: string }) {
  const color = uncertain ? colors.neutral : colors.accent;
  return (
    <View style={styles.probRow} testID={testID} accessible accessibilityLabel={`${label}: ${pct(p)}`}>
      <Row>
        <Txt variant="small" style={{ flex: 1 }} numberOfLines={2}>
          {label}
        </Txt>
        <Txt variant="number">{pct(p)}</Txt>
        {right ? (
          <Txt variant="caption" color={colors.textMuted} style={{ minWidth: 44, textAlign: 'right' }}>
            {right}
          </Txt>
        ) : null}
      </Row>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(0, Math.min(1, p)) * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

/** Home / draw / away split in one bar. */
export function ThreeWayBar({ h, d, a, compact }: { h: number; d: number; a: number; compact?: boolean }) {
  return (
    <View style={{ gap: 4 }} accessible accessibilityLabel={`1 ${pct(h)}, X ${pct(d)}, 2 ${pct(a)}`}>
      <View style={[styles.split, compact && { height: 6 }]}>
        <View style={{ flex: Math.max(h, 0.001), backgroundColor: colors.home }} />
        <View style={{ flex: Math.max(d, 0.001), backgroundColor: colors.draw }} />
        <View style={{ flex: Math.max(a, 0.001), backgroundColor: colors.away }} />
      </View>
      {!compact ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="caption" color={colors.home}>
            1 {pct(h)}
          </Txt>
          <Txt variant="caption" color={colors.draw}>
            X {pct(d)}
          </Txt>
          <Txt variant="caption" color={colors.away}>
            2 {pct(a)}
          </Txt>
        </Row>
      ) : (
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="caption" dense color={colors.textSecondary}>
            {pct(h)}
          </Txt>
          <Txt variant="caption" dense color={colors.textSecondary}>
            {pct(d)}
          </Txt>
          <Txt variant="caption" dense color={colors.textSecondary}>
            {pct(a)}
          </Txt>
        </Row>
      )}
    </View>
  );
}

const levelColor = { low: colors.neutral, medium: colors.info, high: colors.accent } as const;
const gradeColor = { A: colors.accent, B: colors.info, C: colors.warning, D: colors.neutral } as const;

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const { t } = useT();
  return <Pill label={`${t('metric.confidence')}: ${t(`level.${confidence.level}`)}`} color={levelColor[confidence.level]} background={colors.surfaceAlt} />;
}

export function QualityBadge({ quality }: { quality: DataQuality }) {
  const { t } = useT();
  return <Pill label={`${t('metric.quality')}: ${quality.grade}`} color={gradeColor[quality.grade]} background={colors.surfaceAlt} />;
}

export function EvBadge({ ev }: { ev: number | null }) {
  if (ev === null) return <Pill label={`EV: —`} color={colors.textMuted} />;
  const positive = ev > 0;
  return (
    <Pill
      label={`EV ${positive ? '+' : ''}${(ev * 100).toFixed(1)}%`}
      color={positive ? colors.accent : colors.textSecondary}
      background={positive ? colors.accentSoft : colors.surfaceAlt}
    />
  );
}

/** Form letters as small coloured squares (localised letters). */
export function FormRow({ results }: { results: ('W' | 'D' | 'L')[] }) {
  const { t } = useT();
  const bg = { W: colors.accentSoft, D: colors.neutralSoft, L: colors.dangerSoft } as const;
  const fg = { W: colors.accent, D: colors.neutral, L: colors.danger } as const;
  return (
    <Row gap={4}>
      {results.map((r, i) => (
        <View key={i} style={[styles.formBox, { backgroundColor: bg[r] }]}>
          <Txt variant="caption" dense color={fg[r]}>
            {t(`stats.form.${r}`)}
          </Txt>
        </View>
      ))}
    </Row>
  );
}

const styles = StyleSheet.create({
  probRow: { gap: 4, paddingVertical: 4 },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.elevated, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
  split: { flexDirection: 'row', height: 8, borderRadius: radius.pill, overflow: 'hidden', gap: 2 },
  formBox: { width: 22, height: 22, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
});
