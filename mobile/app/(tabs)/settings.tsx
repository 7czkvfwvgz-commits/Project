import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { COMPETITIONS } from '@/config/competitions';
import { APP_VERSION, PROXY_URL } from '@/config/env';
import { modelVersion } from '@/engine/predict';
import { DEFAULT_FIT_OPTIONS } from '@/engine/fit';
import { useCacheStats } from '@/hooks/queries';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/hooks/useT';
import { LANGUAGES } from '@/i18n';
import { getServices } from '@/services/app';
import { useSettings, type SettingsState } from '@/state/settings';
import { formatOffset, offsetMinutes, SUPPORTED_ZONES, getZone } from '@/time/tz';
import { Button, Card, Chip, Icon, Row, SectionHeader, TextButton, Txt } from '@/ui/components/primitives';
import { bytesText } from '@/ui/format';
import { colors, space } from '@/ui/theme';

type BoolKey = { [K in keyof SettingsState]: SettingsState[K] extends boolean ? K : never }[keyof SettingsState];

function Toggle({ label, hint, value, onChange, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <Row style={{ paddingVertical: 6, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="body">{label}</Txt>
        {hint ? (
          <Txt variant="caption" color={colors.textMuted}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.elevated }} accessibilityLabel={label} testID={testID} />
    </Row>
  );
}

export default function SettingsScreen() {
  const { t, lang } = useT();
  const settings = useSettings();
  const client = useQueryClient();
  const cache = useCacheStats();
  const [zonePicker, setZonePicker] = useState(false);
  const now = useNow();
  const zone = getZone(settings.timezone);
  const bool = (key: BoolKey) => ({ value: settings[key] as boolean, onChange: (v: boolean) => settings.set({ [key]: v } as Partial<SettingsState>) });

  const clearCache = async () => {
    const s = await getServices();
    await s.cache.clear();
    await client.invalidateQueries();
    Alert.alert(t('settings.cacheCleared'));
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xxl }} testID="settings-screen">
      <SectionHeader title={t('settings.timezone')} />
      <Card onPress={() => setZonePicker(true)} accessibilityLabel={t('settings.timezone')}>
        <Row>
          <Icon name="globe-outline" size={18} color={colors.textSecondary} />
          <Txt variant="body" style={{ flex: 1 }} testID="current-zone">
            {zone.label[lang]} ({zone.id})
          </Txt>
          <Txt variant="caption" color={colors.textMuted}>
            {formatOffset(offsetMinutes(zone.id, now))}
          </Txt>
          <Icon name="chevron-forward" size={16} color={colors.textMuted} />
        </Row>
      </Card>

      <SectionHeader title={t('settings.language')} />
      <Row>
        {LANGUAGES.map((l) => (
          <Chip key={l.id} label={l.label} selected={settings.language === l.id} onPress={() => settings.set({ language: l.id })} testID={`lang-${l.id}`} />
        ))}
      </Row>

      <SectionHeader title={t('settings.preferredLeagues')} />
      <Card>
        {COMPETITIONS.map((c) => {
          const enabled = settings.enabledCompetitions.includes(c.code);
          const fav = settings.favoriteCompetitions.includes(c.code);
          return (
            <Row key={c.code} style={{ paddingVertical: 4 }}>
              <Pressable onPress={() => settings.toggleFavoriteCompetition(c.code)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${c.name[lang]} ★`}>
                <Icon name={fav ? 'star' : 'star-outline'} size={18} color={fav ? colors.warning : colors.textMuted} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Txt variant="small">
                  {c.country.flag} {c.name[lang]}
                </Txt>
                <Txt variant="caption" color={colors.textMuted}>
                  {[c.openfootball ? 'openfootball' : null, c.footballData ? 'football-data.org' : null].filter(Boolean).join(' + ')}
                  {c.openfootball && !c.openfootballTimeZone ? ` • ${t('kickoff.dateOnly')}` : ''}
                </Txt>
              </View>
              <Switch value={enabled} onValueChange={() => settings.toggleEnabledCompetition(c.code)} trackColor={{ true: colors.accent, false: colors.elevated }} accessibilityLabel={c.name[lang]} />
            </Row>
          );
        })}
      </Card>

      <SectionHeader title={t('settings.display')} />
      <Card>
        <Toggle label={t('settings.showFairOdds')} {...bool('showFairOdds')} />
        <Toggle label={t('settings.compactCards')} {...bool('compactCards')} />
      </Card>

      <SectionHeader title={t('settings.providers')} />
      <Card onPress={() => router.push('/providers')}>
        <Row>
          <Icon name="server-outline" size={18} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Txt variant="body">{t('settings.providersStatus')}</Txt>
            <Txt variant="caption" color={colors.textMuted}>
              {t('settings.proxy')}: {PROXY_URL ?? t('settings.proxyNotConfigured')}
            </Txt>
          </View>
          <Icon name="chevron-forward" size={16} color={colors.textMuted} />
        </Row>
      </Card>

      <SectionHeader title={t('settings.cache')} />
      <Card>
        <Txt variant="small" color={colors.textSecondary}>
          {t('settings.cacheSize', { n: cache.data?.entries ?? 0, size: bytesText(cache.data?.bytes ?? 0) })}
        </Txt>
        <Button label={t('settings.clearCache')} kind="secondary" icon="trash-outline" onPress={clearCache} testID="clear-cache" />
      </Card>

      <SectionHeader title={t('settings.responsible')} />
      <Card>
        <Toggle label={t('settings.hideBetting')} hint={t('settings.hideBettingHint')} {...bool('hideBetting')} testID="toggle-hide-betting" />
        <Toggle label={t('settings.reminders')} {...bool('rgReminders')} />
        <Toggle label={t('settings.bettingNotifications')} hint={t('settings.bettingNotificationsHint')} {...bool('bettingNotifications')} />
        <Toggle label={t('settings.autoRecord')} {...bool('autoRecord')} />
        <Txt variant="caption" color={colors.textMuted}>
          {t('rg.help')}
        </Txt>
        <TextButton label="begambleaware.org" icon="open-outline" onPress={() => Linking.openURL('https://www.begambleaware.org')} />
      </Card>

      <SectionHeader title={t('settings.demoMode')} />
      <Card>
        <Toggle label={t('settings.demoMode')} hint={t('settings.demoModeHint')} {...bool('demoMode')} testID="toggle-demo" />
      </Card>

      <SectionHeader title={t('settings.about')} />
      <Card>
        <Txt variant="small" color={colors.textSecondary}>
          {t('settings.aboutText')} {t('rg.adultsOnly')}
        </Txt>
        <Txt variant="caption" color={colors.textMuted}>
          {t('settings.version', { v: APP_VERSION })} • {modelVersion(DEFAULT_FIT_OPTIONS)}
        </Txt>
        <Txt variant="bodyStrong">{t('settings.attribution')}</Txt>
        <Txt variant="caption" color={colors.textMuted}>
          Fixtures and results: openfootball / football.json — CC0-1.0 (public domain).{'\n'}Football data provided by the Football-Data.org API (when configured).{'\n'}Odds: The Odds API (when configured), or entered manually.
        </Txt>
      </Card>

      <Modal visible={zonePicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setZonePicker(false)}>
        <View style={styles.sheet}>
          <Row>
            <Txt variant="h2" style={{ flex: 1 }}>
              {t('settings.timezone')}
            </Txt>
            <TextButton label={t('common.close')} onPress={() => setZonePicker(false)} />
          </Row>
          <FlatList
            data={SUPPORTED_ZONES}
            keyExtractor={(z) => z.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  settings.set({ timezone: item.id });
                  setZonePicker(false);
                }}
                style={styles.zoneRow}
                accessibilityRole="button"
                testID={`zone-${item.id}`}
              >
                <Txt variant="body" style={{ flex: 1 }}>
                  {item.label[lang]}
                </Txt>
                <Txt variant="caption" color={colors.textMuted}>
                  {item.id} • {formatOffset(offsetMinutes(item.id, now))}
                </Txt>
                {item.id === settings.timezone ? <Icon name="checkmark" size={18} color={colors.accent} /> : null}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
