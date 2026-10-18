import { useNetInfo } from '@react-native-community/netinfo';
import { useEffect, useState, type ComponentProps } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useT';
import { colors, radius, space } from '../theme';
import { Button, Icon, Row, Txt } from './primitives';

export function Skeleton({ height = 16, width = '100%', style }: { height?: number; width?: number | `${number}%`; style?: object }) {
  const [opacity] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ height, width, borderRadius: radius.sm, backgroundColor: colors.elevated, opacity }, style]} />;
}

export function MatchCardSkeleton() {
  return (
    <View style={styles.skelCard} accessibilityLabel="loading">
      <Skeleton width={60} height={12} />
      <Skeleton height={18} />
      <Skeleton height={18} width="80%" />
      <Skeleton height={8} />
    </View>
  );
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View style={{ gap: space.sm }}>
      {Array.from({ length: count }, (_, i) => (
        <MatchCardSkeleton key={i} />
      ))}
    </View>
  );
}

type IconName = ComponentProps<typeof Icon>['name'];

export function StateView({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  tone = 'neutral',
  testID,
}: {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'neutral' | 'warning' | 'danger' | 'info';
  testID?: string;
}) {
  const color = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'info' ? colors.info : colors.neutral;
  return (
    <View style={styles.state} testID={testID} accessibilityRole="summary">
      <Icon name={icon} size={36} color={color} />
      <Txt variant="h2" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {message ? (
        <Txt variant="small" color={colors.textSecondary} style={{ textAlign: 'center' }}>
          {message}
        </Txt>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} kind="secondary" icon="refresh" /> : null}
    </View>
  );
}

export function Banner({ tone, text, icon, testID }: { tone: 'info' | 'warning' | 'danger' | 'demo' | 'neutral'; text: string; icon?: IconName; testID?: string }) {
  const map = {
    info: [colors.info, colors.infoSoft],
    warning: [colors.warning, colors.warningSoft],
    danger: [colors.danger, colors.dangerSoft],
    demo: [colors.demo, colors.demoSoft],
    neutral: [colors.neutral, colors.neutralSoft],
  } as const;
  const [fg, bg] = map[tone];
  return (
    <Row style={[styles.banner, { backgroundColor: bg, borderColor: fg }]} gap={space.sm}>
      <Icon name={icon ?? (tone === 'demo' ? 'flask' : tone === 'danger' ? 'alert-circle' : 'information-circle')} size={18} color={fg} />
      <Txt variant="small" color={colors.text} style={{ flex: 1 }} testID={testID}>
        {text}
      </Txt>
    </Row>
  );
}

export function OfflineBanner() {
  const net = useNetInfo();
  const { t } = useT();
  if (net.isConnected !== false) return null;
  return <Banner tone="warning" icon="cloud-offline" text={t('common.offline')} />;
}

export function DemoBanner() {
  const { t } = useT();
  return <Banner tone="demo" text={t('common.demoBanner')} testID="demo-banner" />;
}

const styles = StyleSheet.create({
  skelCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  state: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: space.sm, alignItems: 'flex-start' },
});
