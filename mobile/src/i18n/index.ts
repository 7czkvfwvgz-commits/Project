import type { Selection } from '@/engine/settlement';
import { bg } from './bg';
import { en } from './en';
import type { Lang, Msg, TKey } from './types';

export type { Lang, Msg, TKey } from './types';

const DICTS: Record<Lang, Record<TKey, string>> = { bg, en };

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: 'bg', label: 'Български' },
  { id: 'en', label: 'English' },
];

const DATE_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * W/D/L result codes inside a `form` parameter are localised (Bulgarian: П/Р/З),
 * and calendar dates (YYYY-MM-DD) are shown as DD.MM.YYYY.
 */
function formatParam(lang: Lang, name: string, value: string | number): string {
  const date = typeof value === 'string' ? DATE_PARAM.exec(value) : null;
  if (date) return `${date[3]}.${date[2]}.${date[1]}`;
  if (name === 'form' && typeof value === 'string') {
    return value
      .split('')
      .map((c) => (c === 'W' || c === 'D' || c === 'L' ? DICTS[lang][`stats.form.${c}`] : c))
      .join('');
  }
  return String(value);
}

export function translate(lang: Lang, key: TKey, params?: Record<string, string | number>): string {
  const template = DICTS[lang][key] ?? bg[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? formatParam(lang, name, params[name] as string | number) : match));
}

export function translateMsg(lang: Lang, msg: Msg): string {
  return translate(lang, msg.key, msg.params);
}

export const MONTHS: Record<Lang, string[]> = {
  bg: ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

export const WEEKDAYS: Record<Lang, string[]> = {
  bg: ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

export const WEEKDAYS_SHORT: Record<Lang, string[]> = {
  bg: ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

const signed = (n: number) => (n > 0 ? `+${n}` : n === 0 ? '0' : `−${Math.abs(n)}`);

/** Human-readable name of a precisely defined selection. */
export function selectionLabel(lang: Lang, sel: Selection, home: string, away: string): string {
  const t = (key: TKey, params?: Record<string, string | number>) => translate(lang, key, params);
  const threeWay = (pick: 'H' | 'D' | 'A') => (pick === 'H' ? t('sel.home', { home }) : pick === 'D' ? t('sel.draw') : t('sel.away', { away }));
  const code = (pick: 'H' | 'D' | 'A') => (pick === 'H' ? '1' : pick === 'D' ? 'X' : '2');
  switch (sel.market) {
    case '1X2':
      return threeWay(sel.pick);
    case 'DC':
      return sel.pick;
    case 'DNB':
      return sel.pick === 'H' ? home : away;
    case 'OU':
      return t(sel.pick === 'O' ? 'sel.over' : 'sel.under', { line: sel.line });
    case 'BTTS':
    case 'HT_BTTS':
      return t(sel.pick === 'Y' ? 'sel.yes' : 'sel.no');
    case 'TEAM_OU':
      return t(sel.pick === 'O' ? 'sel.teamOver' : 'sel.teamUnder', { team: sel.team === 'H' ? home : away, line: sel.line });
    case 'CS':
      return `${sel.home}-${sel.away}`;
    case 'AH':
      return `${sel.team === 'H' ? home : away} ${signed(sel.line)}`;
    case 'EH':
      return `${code(sel.pick)} (${home} ${signed(sel.line)})`;
    case 'HT_1X2':
      return threeWay(sel.pick);
    case 'HT_OU':
      return t(sel.pick === 'O' ? 'sel.over' : 'sel.under', { line: sel.line });
    case 'HTFT':
      return `${code(sel.ht)}/${code(sel.ft)}`;
  }
}

/** Market name plus selection, e.g. "Над/Под голове: Над 2.5". */
export function fullSelectionLabel(lang: Lang, sel: Selection, home: string, away: string): string {
  return `${translate(lang, `market.${sel.market}`)}: ${selectionLabel(lang, sel, home, away)}`;
}
