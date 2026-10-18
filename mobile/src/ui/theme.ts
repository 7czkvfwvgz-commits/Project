/** Dark navy / charcoal palette with restrained green accents. Contrast ratios target WCAG AA on `bg`. */
export const colors = {
  bg: '#0A1120',
  surface: '#111A2C',
  surfaceAlt: '#16213A',
  elevated: '#1B2742',
  border: '#24314F',
  text: '#E8EEF8',
  textSecondary: '#A3B0C6',
  textMuted: '#7E8BA3',
  accent: '#2FCB7E',
  accentSoft: 'rgba(47, 203, 126, 0.14)',
  /** Neutral treatment for uncertain or low-confidence estimates. */
  neutral: '#8A97AE',
  neutralSoft: 'rgba(138, 151, 174, 0.16)',
  warning: '#F2B64C',
  warningSoft: 'rgba(242, 182, 76, 0.14)',
  danger: '#F07272',
  dangerSoft: 'rgba(240, 114, 114, 0.14)',
  info: '#64A8FF',
  infoSoft: 'rgba(100, 168, 255, 0.14)',
  demo: '#C792EA',
  demoSoft: 'rgba(199, 146, 234, 0.16)',
  live: '#FF5D5D',
  home: '#2FCB7E',
  draw: '#8A97AE',
  away: '#64A8FF',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 };

export const font = {
  title: { fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.2 },
  h1: { fontSize: 22, fontWeight: '700' as const },
  h2: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  number: { fontSize: 15, fontWeight: '600' as const, fontVariant: ['tabular-nums' as const] },
};

/** Text may grow with iOS Dynamic Type, but dense rows cap the scale so layouts stay usable. */
export const MAX_FONT_SCALE = 1.6;
export const DENSE_FONT_SCALE = 1.3;
