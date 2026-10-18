import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { isValidDecimalOdds } from '@/engine/odds';
import { parseSelectionKey } from '@/engine/settlement';
import { useSetManualOdds } from '@/hooks/queries';
import { useT } from '@/hooks/useT';
import { fullSelectionLabel } from '@/i18n';
import type { Fixture } from '@/domain/types';
import { Button, Row, Txt } from '../components/primitives';
import { colors, radius, space } from '../theme';

/** Lets the user type the decimal odds they see at a bookmaker. Stored locally and labelled "entered manually". */
export function ManualOddsSheet({ fixture, selectionKey, existing, onClose }: { fixture: Fixture; selectionKey: string | null; existing?: number; onClose: () => void }) {
  const { t, lang } = useT();
  // The parent remounts this sheet (via `key`) for each selection, so initial state is enough.
  const [text, setText] = useState(() => (existing ? existing.toFixed(2) : ''));
  const [error, setError] = useState<string | null>(null);
  const save = useSetManualOdds();
  const sel = selectionKey ? parseSelectionKey(selectionKey) : null;

  const submit = () => {
    const value = Number(text.replace(',', '.'));
    if (!isValidDecimalOdds(value) || !selectionKey) {
      setError(t('match.invalidOdds'));
      return;
    }
    save.mutate({ fixtureId: fixture.id, selectionKey, decimal: Math.round(value * 1000) / 1000 }, { onSuccess: onClose });
  };

  return (
    <Modal visible={!!selectionKey} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheet}>
        <Txt variant="h2">{t('match.manualOddsTitle')}</Txt>
        {sel ? <Txt variant="bodyStrong">{fullSelectionLabel(lang, sel, fixture.home.short, fixture.away.short)}</Txt> : null}
        <Txt variant="small" color={colors.textSecondary}>
          {t('match.manualOddsHint')}
        </Txt>
        <TextInput
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          placeholder="2.10"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          autoFocus
          accessibilityLabel={t('common.odds')}
          testID="manual-odds-input"
        />
        {error ? (
          <Txt variant="small" color={colors.danger}>
            {error}
          </Txt>
        ) : null}
        <Row>
          <View style={{ flex: 1 }}>
            <Button label={t('common.cancel')} kind="secondary" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={t('common.save')} onPress={submit} testID="manual-odds-save" />
          </View>
        </Row>
        {existing && selectionKey ? (
          <Button
            label={t('common.delete')}
            kind="danger"
            icon="trash-outline"
            onPress={() => save.mutate({ fixtureId: fixture.id, selectionKey, decimal: null }, { onSuccess: onClose })}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 22,
    borderRadius: radius.md,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
