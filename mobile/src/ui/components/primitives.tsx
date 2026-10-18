import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { colors, DENSE_FONT_SCALE, font, MAX_FONT_SCALE, radius, space } from '../theme';

type Variant = keyof typeof font;

export function Txt({
  variant = 'body',
  color = colors.text,
  dense,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string; dense?: boolean; style?: StyleProp<TextStyle> }) {
  return <Text maxFontSizeMultiplier={dense ? DENSE_FONT_SCALE : MAX_FONT_SCALE} style={[font[variant], { color }, style]} {...rest} />;
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <Row style={styles.sectionHeader}>
      <Txt variant="h2" style={{ flex: 1 }} accessibilityRole="header">
        {title}
      </Txt>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <Txt variant="small" color={colors.accent}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </Row>
  );
}

export function Chip({ label, selected, onPress, icon, testID }: { label: string; selected?: boolean; onPress?: () => void; icon?: ComponentProps<typeof Ionicons>['name']; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? colors.accent : colors.textSecondary} /> : null}
      <Txt variant="small" dense color={selected ? colors.accent : colors.textSecondary} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Pill({ label, color = colors.textSecondary, background = colors.surfaceAlt }: { label: string; color?: string; background?: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: background }]}>
      <Txt variant="caption" dense color={color} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  icon?: ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  testID?: string;
}) {
  const fg = kind === 'primary' ? colors.bg : kind === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' && { backgroundColor: colors.accent },
        kind === 'secondary' && { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
        kind === 'danger' && { backgroundColor: colors.dangerSoft },
        (pressed || disabled) && { opacity: disabled ? 0.45 : 0.75 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Txt variant="bodyStrong" color={fg}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Compact text action used inside rows (e.g. "Add to slip"). */
export function TextButton({ label, onPress, icon, disabled, testID }: { label: string; onPress: () => void; icon?: ComponentProps<typeof Ionicons>['name']; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 }, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }]}
    >
      {icon ? <Ionicons name={icon} size={16} color={colors.accent} /> : null}
      <Txt variant="small" color={colors.accent}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function KeyValue({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.kv}>
      <Txt variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
        {label}
      </Txt>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt variant="number">{value}</Txt>
        {hint ? (
          <Txt variant="caption" color={colors.textMuted}>
            {hint}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

export function Icon(props: ComponentProps<typeof Ionicons>) {
  return <Ionicons {...props} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  pressed: { opacity: 0.8 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.xs },
  sectionHeader: { marginTop: space.lg, marginBottom: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: 12,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    minHeight: 44,
  },
  kv: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: space.sm },
});
