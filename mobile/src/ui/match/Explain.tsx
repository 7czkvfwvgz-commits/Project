import { View } from 'react-native';
import { useT } from '@/hooks/useT';
import type { MatchAnalysis } from '@/services/analysis';
import { Card, Icon, Row, Txt } from '../components/primitives';
import { colors, space } from '../theme';
import { Bullets } from './shared';

const ICONS = {
  support: 'checkmark-circle-outline',
  conflict: 'alert-circle-outline',
  failure: 'remove-circle-outline',
} as const;

export function Explain({ analysis }: { analysis: MatchAnalysis }) {
  const { t } = useT();
  const e = analysis.explanation;
  if (!e) return null;
  return (
    <View style={{ gap: space.md }}>
      <Row gap={6}>
        <Icon name="construct-outline" size={16} color={colors.textSecondary} />
        <Txt variant="caption" color={colors.textSecondary} testID="explain-generator">
          {t('exp.title')}
        </Txt>
      </Row>
      {e.sections.map((s) => (
        <Card key={s.id}>
          <Txt variant="bodyStrong" accessibilityRole="header">
            {t(`exp.section.${s.id}`)}
          </Txt>
          <Bullets
            items={s.items}
            icon={(ICONS as Record<string, (typeof ICONS)[keyof typeof ICONS]>)[s.id] ?? 'ellipse'}
            color={s.id === 'conflict' || s.id === 'failure' ? colors.warning : colors.textSecondary}
          />
        </Card>
      ))}
    </View>
  );
}
