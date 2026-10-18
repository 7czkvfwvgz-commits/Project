import {
  addDays,
  dayBoundsUtc,
  diffDays,
  enumerateDays,
  formatOffset,
  isDateKey,
  localDateKey,
  offsetMinutes,
  SUPPORTED_ZONES,
  toZoned,
  todayKey,
  zonedToUtc,
} from '@/time/tz';

function icuOffset(zone: string, t: number): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return Math.round((wall - Math.floor(t / 60000) * 60000) / 60000);
}

const H = 3_600_000;

describe('time-zone rules', () => {
  it.each(SUPPORTED_ZONES.map((z) => [z.id]))('%s matches ICU every 3 hours 2025–2028', (zone) => {
    for (let t = Date.UTC(2025, 0, 1); t < Date.UTC(2029, 0, 1); t += 3 * H) {
      expect(offsetMinutes(zone, t)).toBe(icuOffset(zone, t));
    }
  });

  it('switches exactly at the EU transition instants (Sofia, 2026)', () => {
    // DST starts 2026-03-29 01:00 UTC and ends 2026-10-25 01:00 UTC.
    expect(offsetMinutes('Europe/Sofia', Date.UTC(2026, 2, 29, 0, 59))).toBe(120);
    expect(offsetMinutes('Europe/Sofia', Date.UTC(2026, 2, 29, 1, 0))).toBe(180);
    expect(offsetMinutes('Europe/Sofia', Date.UTC(2026, 9, 25, 0, 59))).toBe(180);
    expect(offsetMinutes('Europe/Sofia', Date.UTC(2026, 9, 25, 1, 0))).toBe(120);
  });

  it('matches ICU minute-by-minute around US and Australian transitions', () => {
    const windows: [string, number][] = [
      ['America/New_York', Date.UTC(2026, 2, 8, 5)],
      ['America/New_York', Date.UTC(2026, 10, 1, 5)],
      ['Australia/Sydney', Date.UTC(2026, 3, 4, 14)],
      ['Australia/Sydney', Date.UTC(2026, 9, 3, 14)],
    ];
    for (const [zone, centre] of windows) {
      for (let t = centre - 3 * H; t <= centre + 3 * H; t += 15 * 60_000) expect(offsetMinutes(zone, t)).toBe(icuOffset(zone, t));
    }
  });
});

describe('wall-clock conversion', () => {
  it('converts a UK league kickoff to UTC in summer and winter', () => {
    expect(zonedToUtc({ year: 2026, month: 8, day: 22, hour: 15, minute: 0 }, 'Europe/London')).toBe(Date.UTC(2026, 7, 22, 14, 0));
    expect(zonedToUtc({ year: 2026, month: 12, day: 26, hour: 15, minute: 0 }, 'Europe/London')).toBe(Date.UTC(2026, 11, 26, 15, 0));
  });

  it('round-trips every hour of 2026 in Sofia', () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += H) {
      const z = toZoned(t, 'Europe/Sofia');
      const back = zonedToUtc(z, 'Europe/Sofia');
      // Only the repeated autumn hour is ambiguous; it resolves to the earlier instant.
      if (back !== t) expect(t - back).toBe(H);
    }
  });

  it('resolves the autumn overlap to the earlier instant', () => {
    // 03:30 happens twice in Sofia on 2026-10-25.
    const t = zonedToUtc({ year: 2026, month: 10, day: 25, hour: 3, minute: 30 }, 'Europe/Sofia');
    expect(t).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });

  it('moves non-existent spring times forward', () => {
    // 03:30 does not exist in Sofia on 2026-03-29 (03:00 → 04:00).
    const t = zonedToUtc({ year: 2026, month: 3, day: 29, hour: 3, minute: 30 }, 'Europe/Sofia');
    expect(toZoned(t, 'Europe/Sofia')).toMatchObject({ hour: 4, minute: 30 });
  });
});

describe('calendar days', () => {
  it('has 23- and 25-hour days at DST changes', () => {
    const spring = dayBoundsUtc('2026-03-29', 'Europe/Sofia');
    const autumn = dayBoundsUtc('2026-10-25', 'Europe/Sofia');
    const normal = dayBoundsUtc('2026-10-18', 'Europe/Sofia');
    expect(spring.end - spring.start).toBe(23 * H);
    expect(autumn.end - autumn.start).toBe(25 * H);
    expect(normal.end - normal.start).toBe(24 * H);
  });

  it('places a late UK kickoff on the next day in Sofia (crossing midnight)', () => {
    // 22:30 in London on 2026-10-18 is 00:30 on 2026-10-19 in Sofia.
    const kickoff = zonedToUtc({ year: 2026, month: 10, day: 18, hour: 22, minute: 30 }, 'Europe/London');
    expect(localDateKey(kickoff, 'Europe/London')).toBe('2026-10-18');
    expect(localDateKey(kickoff, 'Europe/Sofia')).toBe('2026-10-19');
    expect(localDateKey(kickoff, 'America/New_York')).toBe('2026-10-18');
  });

  it('places a Brazilian evening match on the next day in Sofia', () => {
    const kickoff = zonedToUtc({ year: 2026, month: 11, day: 4, hour: 21, minute: 30 }, 'America/Sao_Paulo');
    expect(localDateKey(kickoff, 'Europe/Sofia')).toBe('2026-11-05');
  });

  it('does date-key arithmetic across month, year and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-10-18', '2026-10-25')).toBe(7);
    expect(enumerateDays('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('validates date keys', () => {
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('18.10.2026')).toBe(false);
  });

  it('computes today in the selected zone', () => {
    const now = Date.UTC(2026, 9, 18, 22, 30);
    expect(todayKey('Europe/Sofia', now)).toBe('2026-10-19');
    expect(todayKey('Europe/London', now)).toBe('2026-10-18');
  });

  it('formats offsets', () => {
    expect(formatOffset(180)).toBe('UTC+03:00');
    expect(formatOffset(-210)).toBe('UTC−03:30');
  });
});
