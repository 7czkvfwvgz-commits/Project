/**
 * Deterministic time-zone rules for every zone the app can display or that a
 * supported competition plays in.
 *
 * Hermes' Intl support (time-zone names, formatToParts) differs between
 * platforms and engine versions, so kickoff conversion does not depend on it at
 * runtime. The rules below are verified hour-by-hour against Node's full ICU
 * database in __tests__/tz.test.ts, including every DST transition 2024–2030.
 */

export type DstRule = 'EU' | 'US' | 'AU' | 'NONE';

export interface ZoneDef {
  id: string;
  /** Standard (winter) offset from UTC in minutes. */
  stdOffsetMin: number;
  dst: DstRule;
  label: { bg: string; en: string };
}

const MINUTE = 60_000;
const DAY = 86_400_000;

export const DEFAULT_ZONE = 'Europe/Sofia';

export const SUPPORTED_ZONES: readonly ZoneDef[] = [
  { id: 'Europe/Sofia', stdOffsetMin: 120, dst: 'EU', label: { bg: 'София', en: 'Sofia' } },
  { id: 'UTC', stdOffsetMin: 0, dst: 'NONE', label: { bg: 'UTC', en: 'UTC' } },
  { id: 'Europe/London', stdOffsetMin: 0, dst: 'EU', label: { bg: 'Лондон', en: 'London' } },
  { id: 'Europe/Dublin', stdOffsetMin: 0, dst: 'EU', label: { bg: 'Дъблин', en: 'Dublin' } },
  { id: 'Europe/Lisbon', stdOffsetMin: 0, dst: 'EU', label: { bg: 'Лисабон', en: 'Lisbon' } },
  { id: 'Europe/Madrid', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Мадрид', en: 'Madrid' } },
  { id: 'Europe/Paris', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Париж', en: 'Paris' } },
  { id: 'Europe/Brussels', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Брюксел', en: 'Brussels' } },
  { id: 'Europe/Amsterdam', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Амстердам', en: 'Amsterdam' } },
  { id: 'Europe/Berlin', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Берлин', en: 'Berlin' } },
  { id: 'Europe/Rome', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Рим', en: 'Rome' } },
  { id: 'Europe/Vienna', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Виена', en: 'Vienna' } },
  { id: 'Europe/Zurich', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Цюрих', en: 'Zurich' } },
  { id: 'Europe/Prague', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Прага', en: 'Prague' } },
  { id: 'Europe/Warsaw', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Варшава', en: 'Warsaw' } },
  { id: 'Europe/Budapest', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Будапеща', en: 'Budapest' } },
  { id: 'Europe/Belgrade', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Белград', en: 'Belgrade' } },
  { id: 'Europe/Copenhagen', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Копенхаген', en: 'Copenhagen' } },
  { id: 'Europe/Stockholm', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Стокхолм', en: 'Stockholm' } },
  { id: 'Europe/Oslo', stdOffsetMin: 60, dst: 'EU', label: { bg: 'Осло', en: 'Oslo' } },
  { id: 'Europe/Athens', stdOffsetMin: 120, dst: 'EU', label: { bg: 'Атина', en: 'Athens' } },
  { id: 'Europe/Bucharest', stdOffsetMin: 120, dst: 'EU', label: { bg: 'Букурещ', en: 'Bucharest' } },
  { id: 'Europe/Helsinki', stdOffsetMin: 120, dst: 'EU', label: { bg: 'Хелзинки', en: 'Helsinki' } },
  { id: 'Europe/Istanbul', stdOffsetMin: 180, dst: 'NONE', label: { bg: 'Истанбул', en: 'Istanbul' } },
  { id: 'Europe/Moscow', stdOffsetMin: 180, dst: 'NONE', label: { bg: 'Москва', en: 'Moscow' } },
  { id: 'Asia/Dubai', stdOffsetMin: 240, dst: 'NONE', label: { bg: 'Дубай', en: 'Dubai' } },
  { id: 'Asia/Kolkata', stdOffsetMin: 330, dst: 'NONE', label: { bg: 'Индия (Колката)', en: 'India (Kolkata)' } },
  { id: 'Asia/Shanghai', stdOffsetMin: 480, dst: 'NONE', label: { bg: 'Шанхай', en: 'Shanghai' } },
  { id: 'Asia/Tokyo', stdOffsetMin: 540, dst: 'NONE', label: { bg: 'Токио', en: 'Tokyo' } },
  { id: 'Australia/Sydney', stdOffsetMin: 600, dst: 'AU', label: { bg: 'Сидни', en: 'Sydney' } },
  { id: 'America/Sao_Paulo', stdOffsetMin: -180, dst: 'NONE', label: { bg: 'Сао Пауло', en: 'São Paulo' } },
  { id: 'America/New_York', stdOffsetMin: -300, dst: 'US', label: { bg: 'Ню Йорк', en: 'New York' } },
  { id: 'America/Chicago', stdOffsetMin: -360, dst: 'US', label: { bg: 'Чикаго', en: 'Chicago' } },
  { id: 'America/Denver', stdOffsetMin: -420, dst: 'US', label: { bg: 'Денвър', en: 'Denver' } },
  { id: 'America/Los_Angeles', stdOffsetMin: -480, dst: 'US', label: { bg: 'Лос Анджелис', en: 'Los Angeles' } },
  { id: 'America/Mexico_City', stdOffsetMin: -360, dst: 'NONE', label: { bg: 'Мексико', en: 'Mexico City' } },
];

const ZONES_BY_ID = new Map(SUPPORTED_ZONES.map((z) => [z.id, z]));

export function isSupportedZone(id: string): boolean {
  return ZONES_BY_ID.has(id);
}

export function getZone(id: string): ZoneDef {
  return ZONES_BY_ID.get(id) ?? (ZONES_BY_ID.get('UTC') as ZoneDef);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Day of month of the last Sunday in `month` (1–12). */
function lastSunday(year: number, month: number): number {
  const last = daysInMonth(year, month);
  const weekday = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
  return last - weekday;
}

/** Day of month of the n-th Sunday in `month` (1–12). */
function nthSunday(year: number, month: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - firstWeekday) % 7) + 7 * (n - 1);
}

function isDst(zone: ZoneDef, utcMs: number): boolean {
  const year = new Date(utcMs).getUTCFullYear();
  const std = zone.stdOffsetMin * MINUTE;
  switch (zone.dst) {
    case 'NONE':
      return false;
    case 'EU': {
      // Last Sunday of March 01:00 UTC → last Sunday of October 01:00 UTC.
      const start = Date.UTC(year, 2, lastSunday(year, 3), 1);
      const end = Date.UTC(year, 9, lastSunday(year, 10), 1);
      return utcMs >= start && utcMs < end;
    }
    case 'US': {
      // Second Sunday of March 02:00 local standard → first Sunday of November 02:00 local daylight.
      const start = Date.UTC(year, 2, nthSunday(year, 3, 2), 2) - std;
      const end = Date.UTC(year, 10, nthSunday(year, 11, 1), 2) - std - 60 * MINUTE;
      return utcMs >= start && utcMs < end;
    }
    case 'AU': {
      // Southern hemisphere: first Sunday of October 02:00 standard → first Sunday of April 03:00 daylight.
      const end = Date.UTC(year, 3, nthSunday(year, 4, 1), 3) - std - 60 * MINUTE;
      const start = Date.UTC(year, 9, nthSunday(year, 10, 1), 2) - std;
      return utcMs < end || utcMs >= start;
    }
  }
}

/** Offset from UTC (minutes) in effect in `zoneId` at the instant `utcMs`. */
export function offsetMinutes(zoneId: string, utcMs: number): number {
  const zone = getZone(zoneId);
  return zone.stdOffsetMin + (isDst(zone, utcMs) ? 60 : 0);
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  offsetMin: number;
}

export function toZoned(utcMs: number, zoneId: string): ZonedParts {
  const offsetMin = offsetMinutes(zoneId, utcMs);
  const d = new Date(utcMs + offsetMin * MINUTE);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
    offsetMin,
  };
}

export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * Convert a wall-clock time in `zoneId` to a UTC instant.
 * Ambiguous times (autumn overlap) resolve to the earlier instant; non-existent
 * times (spring gap) are shifted forward — the same as Temporal's "compatible".
 */
export function zonedToUtc(local: LocalDateTime, zoneId: string): number {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const before = offsetMinutes(zoneId, asUtc - DAY);
  const after = offsetMinutes(zoneId, asUtc + DAY);
  const candidates = [...new Set([before, after])]
    .map((o) => asUtc - o * MINUTE)
    .filter((t) => offsetMinutes(zoneId, t) * MINUTE === asUtc - t);
  if (candidates.length > 0) return Math.min(...candidates);
  return asUtc - before * MINUTE;
}

// ---------------------------------------------------------------------------
// Calendar date keys (YYYY-MM-DD). These are plain calendar dates, independent
// of any zone; zone-aware helpers below convert between keys and instants.

export type DateKey = string;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(value: string): boolean {
  const m = DATE_KEY_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseDateKey(key: DateKey): { year: number; month: number; day: number } {
  const m = DATE_KEY_RE.exec(key);
  if (!m || !isDateKey(key)) throw new Error(`Invalid date key: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function makeDateKey(year: number, month: number, day: number): DateKey {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function addDays(key: DateKey, n: number): DateKey {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return makeDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole calendar days from `a` to `b` (b − a). */
export function diffDays(a: DateKey, b: DateKey): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / DAY);
}

export function weekdayOfKey(key: DateKey): number {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function enumerateDays(from: DateKey, to: DateKey): DateKey[] {
  const n = diffDays(from, to);
  const out: DateKey[] = [];
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

export function localDateKey(utcMs: number, zoneId: string): DateKey {
  const p = toZoned(utcMs, zoneId);
  return makeDateKey(p.year, p.month, p.day);
}

export function todayKey(zoneId: string, nowMs: number = Date.now()): DateKey {
  return localDateKey(nowMs, zoneId);
}

/** [start, end) UTC instants of the local calendar day — 23 or 25 hours long on DST change days. */
export function dayBoundsUtc(key: DateKey, zoneId: string): { start: number; end: number } {
  const { year, month, day } = parseDateKey(key);
  const next = parseDateKey(addDays(key, 1));
  return {
    start: zonedToUtc({ year, month, day, hour: 0, minute: 0 }, zoneId),
    end: zonedToUtc({ ...next, hour: 0, minute: 0 }, zoneId),
  };
}

export function formatOffset(offsetMin: number): string {
  const sign = offsetMin < 0 ? '−' : '+';
  const abs = Math.abs(offsetMin);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}
