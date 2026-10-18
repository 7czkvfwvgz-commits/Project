import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useT';
import { MAX_RANGE_DAYS } from '@/state/ui';
import { addDays, diffDays, makeDateKey, parseDateKey, todayKey, type DateKey } from '@/time/tz';
import { dayChipLabel, longDate, shortDate } from '../format';
import { colors, radius, space } from '../theme';
import { Button, Chip, Icon, Row, Txt } from './primitives';

function toJsDate(key: DateKey): Date {
  const { year, month, day } = parseDateKey(key);
  // Noon local time, so the device's zone cannot shift the calendar day.
  return new Date(year, month - 1, day, 12);
}

function fromJsDate(d: Date): DateKey {
  return makeDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export interface DateBarProps {
  date: DateKey;
  zone: string;
  onChange: (date: DateKey) => void;
  rangeEnd?: DateKey | null;
  onRangeChange?: (end: DateKey | null) => void;
}

export function DateBar({ date, zone, onChange, rangeEnd, onRangeChange }: DateBarProps) {
  const { t, lang } = useT();
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const today = todayKey(zone);
  const quick = [addDays(today, -1), today, addDays(today, 1)];
  const rangeOn = !!rangeEnd;

  const pick = (key: DateKey) => {
    if (picker === 'end' && onRangeChange) {
      const span = diffDays(date, key);
      onRangeChange(span < 0 ? date : span >= MAX_RANGE_DAYS ? addDays(date, MAX_RANGE_DAYS - 1) : key);
    } else {
      onChange(key);
      if (rangeEnd && onRangeChange && (diffDays(key, rangeEnd) < 0 || diffDays(key, rangeEnd) >= MAX_RANGE_DAYS)) onRangeChange(addDays(key, Math.min(2, MAX_RANGE_DAYS - 1)));
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <Row>
        <Pressable onPress={() => onChange(addDays(date, -1))} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('date.prev')} testID="date-prev">
          <Icon name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Pressable style={{ flex: 1 }} onPress={() => setPicker('start')} accessibilityRole="button" accessibilityLabel={t('date.pick')} testID="date-open-picker">
          <Txt variant="h2" style={{ textAlign: 'center' }} testID="date-label">
            {rangeOn ? t('date.rangeLabel', { from: shortDate(date), to: shortDate(rangeEnd as DateKey) }) : longDate(date, lang)}
          </Txt>
        </Pressable>
        <Pressable onPress={() => onChange(addDays(date, 1))} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('date.next')} testID="date-next">
          <Icon name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {quick.map((k) => (
          <Chip key={k} label={dayChipLabel(k, zone, lang)} selected={!rangeOn && k === date} onPress={() => onChange(k)} testID={`date-chip-${k}`} />
        ))}
        <Chip label={t('date.pick')} icon="calendar-outline" onPress={() => setPicker('start')} />
        {onRangeChange ? (
          <Chip
            label={t('date.range')}
            icon="swap-horizontal"
            selected={rangeOn}
            onPress={() => onRangeChange(rangeOn ? null : addDays(date, 2))}
            testID="date-range-toggle"
          />
        ) : null}
        {rangeOn ? <Chip label={`${t('date.to')}: ${shortDate(rangeEnd as DateKey)}`} onPress={() => setPicker('end')} /> : null}
      </ScrollView>

      <Modal visible={picker !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(null)}>
        <View style={styles.sheet}>
          <Txt variant="h2">{picker === 'end' ? `${t('date.to')} (${t('date.maxRange', { n: MAX_RANGE_DAYS })})` : t('date.pick')}</Txt>
          <DateTimePicker
            value={toJsDate(picker === 'end' && rangeEnd ? rangeEnd : date)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            themeVariant="dark"
            accentColor={colors.accent}
            locale={lang === 'bg' ? 'bg-BG' : 'en-GB'}
            minimumDate={picker === 'end' ? toJsDate(date) : undefined}
            maximumDate={picker === 'end' ? toJsDate(addDays(date, MAX_RANGE_DAYS - 1)) : undefined}
            onChange={(event, selected) => {
              if (event.type === 'dismissed') {
                setPicker(null);
                return;
              }
              if (selected) pick(fromJsDate(selected));
              if (Platform.OS !== 'ios') setPicker(null);
            }}
          />
          <Button label={t('common.done')} onPress={() => setPicker(null)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
});
