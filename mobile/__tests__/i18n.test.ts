import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fullSelectionLabel, selectionLabel, translate } from '@/i18n';
import { bg } from '@/i18n/bg';
import { en } from '@/i18n/en';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('localisation', () => {
  it('English provides exactly the Bulgarian keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(bg).sort());
  });

  it('uses the same placeholders in every language', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(bg) as (keyof typeof bg)[]) {
      expect([key, placeholders(en[key])]).toEqual([key, placeholders(bg[key])]);
    }
  });

  it('interpolates parameters and localises form letters', () => {
    expect(translate('bg', 'exp.form', { team: 'Левски', n: 5, form: 'WWDLW', gf: 9, ga: 4, pts: 10 })).toBe(
      'Левски: последни 5 — ППРЗП, голове 9:4, 10 т.',
    );
    expect(translate('en', 'exp.form', { team: 'Levski', n: 5, form: 'WWDLW', gf: 9, ga: 4, pts: 10 })).toContain('WWDLW');
  });

  it('uses natural Bulgarian football terminology', () => {
    expect(bg['market.OU']).toBe('Над/Под голове');
    expect(bg['market.BTTS']).toBe('Двата отбора да отбележат');
    expect(bg['market.1X2']).toBe('Краен резултат');
    expect(bg['market.DC']).toBe('Двоен шанс');
    expect(bg['metric.risk']).toBe('Оценка на риска');
    expect(bg['common.odds']).toBe('Коефициент');
    expect(bg['common.probability']).toBe('Вероятност');
  });

  it('labels selections', () => {
    expect(selectionLabel('bg', { market: 'OU', line: 2.5, pick: 'O' }, 'А', 'Б')).toBe('Над 2.5');
    expect(selectionLabel('bg', { market: 'AH', team: 'H', line: -0.75 }, 'Арсенал', 'Челси')).toBe('Арсенал −0.75');
    expect(selectionLabel('en', { market: 'HTFT', ht: 'D', ft: 'H' }, 'A', 'B')).toBe('X/1');
    expect(fullSelectionLabel('bg', { market: 'BTTS', pick: 'Y' }, 'А', 'Б')).toBe('Двата отбора да отбележат: Да');
  });

  it('every translation key referenced in source code exists', () => {
    const root = join(__dirname, '..');
    const files = [...sourceFiles(join(root, 'src')), ...sourceFiles(join(root, 'app'))];
    const missing: string[] = [];
    const keyPattern = /(?:key:\s*|\bt\(\s*|translate\(\s*\w+,\s*)'([a-z0-9_]+(?:\.[A-Za-z0-9_]+)+)'/g;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(keyPattern)) {
        const key = m[1] as string;
        if (!(key in bg)) missing.push(`${key} (${file})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('never calls a selection safe or guaranteed', () => {
    // "несигурност" (uncertainty) is fine; "сигурен/сигурно" (safe/certain) is not.
    const forbidden = /(?<!не)сигурн|гарантиран|safe bet|guaranteed|\block\b/i;
    for (const [key, value] of Object.entries(bg)) {
      if (key === 'analysis.disclaimer' || key.startsWith('rg.') || key === 'settings.aboutText') continue;
      expect([key, forbidden.test(value)]).toEqual([key, false]);
    }
  });
});
