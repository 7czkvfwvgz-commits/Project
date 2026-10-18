import type { Fixture } from '@/domain/types';
import { MONTHS, translate, WEEKDAYS, WEEKDAYS_SHORT, type Lang } from '@/i18n';
import { addDays, parseDateKey, toZoned, todayKey, weekdayOfKey, type DateKey } from '@/time/tz';

const pad = (n: number) => String(n).padStart(2, '0');

export function pct(p: number | null | undefined, digits = 0): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  const v = p * 100;
  if (v > 0 && v < 1 && digits === 0) return '<1%';
  if (v < 100 && v > 99 && digits === 0) return '>99%';
  return `${v.toFixed(digits)}%`;
}

export function signedPct(p: number, digits = 1): string {
  const v = p * 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;
}

export const oddsText = (d: number | null | undefined) => (d && Number.isFinite(d) ? d.toFixed(2) : '—');

export function timeText(utcMs: number, zone: string): string {
  const z = toZoned(utcMs, zone);
  return `${pad(z.hour)}:${pad(z.minute)}`;
}

export function kickoffText(f: Fixture, zone: string): string {
  return f.kickoffUtc !== null ? timeText(f.kickoffUtc, zone) : '—:—';
}

export function dateTimeText(utcMs: number, zone: string): string {
  const z = toZoned(utcMs, zone);
  return `${pad(z.day)}.${pad(z.month)}.${z.year} ${pad(z.hour)}:${pad(z.minute)}`;
}

export function shortDate(key: DateKey): string {
  const { day, month, year } = parseDateKey(key);
  return `${pad(day)}.${pad(month)}.${year}`;
}

export function longDate(key: DateKey, lang: Lang): string {
  const { day, month, year } = parseDateKey(key);
  const weekday = WEEKDAYS[lang][weekdayOfKey(key)] as string;
  const monthName = MONTHS[lang][month - 1] as string;
  return lang === 'bg' ? `${weekday}, ${day} ${monthName} ${year}` : `${weekday}, ${day} ${monthName} ${year}`;
}

export function dayChipLabel(key: DateKey, zone: string, lang: Lang, now = Date.now()): string {
  const today = todayKey(zone, now);
  if (key === today) return translate(lang, 'common.today');
  if (key === addDays(today, 1)) return translate(lang, 'common.tomorrow');
  if (key === addDays(today, -1)) return translate(lang, 'common.yesterday');
  const { day, month } = parseDateKey(key);
  return `${WEEKDAYS_SHORT[lang][weekdayOfKey(key)]} ${day}.${pad(month)}`;
}

export function agoText(ms: number, lang: Lang, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return translate(lang, 'common.agoNow');
  if (min < 60) return translate(lang, 'common.agoMinutes', { n: min });
  const h = Math.floor(min / 60);
  if (h < 48) return translate(lang, 'common.agoHours', { n: h });
  return translate(lang, 'common.agoDays', { n: Math.floor(h / 24) });
}

export function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
