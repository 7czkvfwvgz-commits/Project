import type { bg } from './bg';

export type TKey = keyof typeof bg;

/** A message the engine produces without knowing the UI language. */
export interface Msg {
  key: TKey;
  params?: Record<string, string | number>;
}

export type Lang = 'bg' | 'en';
