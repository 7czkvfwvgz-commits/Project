import { useQuery } from '@tanstack/react-query';
import { Linking, ScrollView, View } from 'react-native';
import { PROXY_URL } from '@/config/env';
import { useProxyHealth } from '@/hooks/queries';
import { useT } from '@/hooks/useT';
import { allCapabilities } from '@/providers/registry';
import { ALL_FIELDS, type ProviderCapabilities } from '@/providers/types';
import { getServices } from '@/services/app';
import { Button, Card, Icon, Pill, Row, TextButton, Txt } from '@/ui/components/primitives';
import { ListSkeleton } from '@/ui/components/states';
import { colors, space } from '@/ui/theme';

function ProviderCard({ cap }: { cap: ProviderCapabilities }) {
  const { t } = useT();
  const supported = ALL_FIELDS.filter((f) => cap.fields[f] !== 'unsupported');
  const unsupported = ALL_FIELDS.filter((f) => cap.fields[f] === 'unsupported');
  return (
    <Card testID={`provider-${cap.id}`}>
      <Row>
        <Txt variant="h2" style={{ flex: 1 }}>
          {t(`prov.${cap.id}`)}
        </Txt>
        <Pill
          label={cap.configured ? (cap.requiresCredentials ? t('prov.configured') : t('prov.noKeyNeeded')) : t('prov.notConfigured')}
          color={cap.configured ? colors.accent : colors.warning}
          background={cap.configured ? colors.accentSoft : colors.warningSoft}
        />
      </Row>
      <Txt variant="caption" color={colors.textSecondary}>
        {t('prov.kinds', { kinds: cap.roles.map((r) => t(`prov.role.${r}`)).join(', ') })} • {t('prov.freshness', { kind: t(`fresh.${cap.dataKind}`) })}
        {cap.requiresCredentials ? ` • ${t('prov.viaProxy')}` : ''}
      </Txt>
      <Txt variant="caption" color={colors.textMuted}>
        {t('prov.terms', { terms: cap.terms })}
      </Txt>
      <Txt variant="caption" color={colors.textMuted}>
        {cap.attribution}
      </Txt>
      <Txt variant="caption" color={colors.textMuted}>
        {t('prov.fields')}:
      </Txt>
      <Row style={{ flexWrap: 'wrap' }} gap={4}>
        {supported.map((f) => (
          <Pill key={f} label={`${t(`field.${f}`)}${cap.fields[f] === 'partial' ? ' ½' : ''}`} color={colors.accent} background={colors.accentSoft} />
        ))}
      </Row>
      <Row style={{ flexWrap: 'wrap' }} gap={4}>
        {unsupported.map((f) => (
          <Pill key={f} label={t(`field.${f}`)} color={colors.textMuted} />
        ))}
      </Row>
      {cap.homepage ? <TextButton label={cap.homepage} icon="open-outline" onPress={() => Linking.openURL(cap.homepage)} /> : null}
    </Card>
  );
}

export default function ProvidersScreen() {
  const { t } = useT();
  const caps = useQuery({ queryKey: ['capabilities'], queryFn: async () => allCapabilities((await getServices()).providers) });
  const health = useProxyHealth();
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}>
      <Card>
        <Txt variant="bodyStrong">{t('settings.proxy')}</Txt>
        <Txt variant="caption" color={colors.textMuted}>
          {PROXY_URL ?? t('settings.proxyNotConfigured')}
        </Txt>
        {PROXY_URL ? (
          <>
            <Row>
              <Icon name={health.isSuccess ? 'checkmark-circle' : health.isError ? 'close-circle' : 'ellipse-outline'} size={16} color={health.isSuccess ? colors.accent : health.isError ? colors.danger : colors.neutral} />
              <Txt variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                {health.isSuccess
                  ? `${t('prov.proxyOk')} • football-data.org: ${health.data.providers?.footballData.configured ? t('prov.configured') : t('prov.notConfigured')} • The Odds API: ${health.data.providers?.odds.configured ? t('prov.configured') : t('prov.notConfigured')}`
                  : health.isError
                    ? t('prov.proxyFail', { error: String(health.error) })
                    : t('common.loading')}
              </Txt>
            </Row>
            <Button label={t('prov.checkProxy')} kind="secondary" icon="pulse-outline" onPress={() => health.refetch()} />
          </>
        ) : null}
      </Card>
      {caps.isLoading ? <ListSkeleton count={3} /> : (caps.data ?? []).map((c) => <ProviderCard key={c.id} cap={c} />)}
      <View />
    </ScrollView>
  );
}
