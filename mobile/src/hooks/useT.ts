import { useCallback } from 'react';
import { translate, translateMsg, type Msg, type TKey } from '@/i18n';
import { useSettings } from '@/state/settings';

export function useLang() {
  return useSettings((s) => s.language);
}

export function useT() {
  const lang = useLang();
  const t = useCallback((key: TKey, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);
  const tm = useCallback((msg: Msg) => translateMsg(lang, msg), [lang]);
  return { t, tm, lang };
}
