import type { TeamRef } from './types';

/** Club-form tokens that carry no identity ("FC", "Calcio", founding years …). */
const NOISE_TOKENS = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'ssc', 'as', 'cd', 'ud', 'rc', 'rcd', 'sd', 'ca', 'sv', 'vfb', 'vfl', 'tsg',
  'fsv', 'bsc', 'fk', 'sk', 'nk', 'ks', 'us', 'club', 'clube', 'de', 'del', 'la', 'le', 'futebol', 'calcio',
  'football', 'futbol', 'sad', 'and', 'the', 'cp', 'ec', 'esporte', 'sport', 'spor', 'kulubu', 'jk', 'bk', 'if',
  'cfc', 'hsc', 'osc', 'aj', 'ogc', 'rb', 'es',
]);

/** Common alternative spellings across providers, mapped to a canonical token. */
const TOKEN_ALIASES: Record<string, string> = {
  munich: 'munchen',
  inter: 'internazionale',
  man: 'manchester',
  utd: 'united',
  st: 'saint',
  cologne: 'koln',
  nuremberg: 'nurnberg',
  seville: 'sevilla',
  gladbach: 'monchengladbach',
  wolves: 'wolverhampton',
  spurs: 'tottenham',
  psg: 'paris',
  lisbon: 'lisboa',
};

const SUFFIX_TOKENS = /\s+(FC|AFC|CF|SC|FK|SK|CFC)$/i;
const PREFIX_TOKENS = /^(FC|AFC)\s+/i;

export function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokens(name: string): string[] {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function identityTokens(name: string): string[] {
  const all = tokens(name);
  const kept = all.filter((t) => !NOISE_TOKENS.has(t) && !/^\d+$/.test(t)).map((t) => TOKEN_ALIASES[t] ?? t);
  return kept.length > 0 ? kept : all;
}

/** Stable identity of a club name, e.g. "1. FC Köln" → "koln", "Brighton & Hove Albion FC" → "brighton-hove-albion". */
export function teamKey(name: string): string {
  return identityTokens(name).join('-');
}

export function shortTeamName(name: string): string {
  const trimmed = name.trim().replace(SUFFIX_TOKENS, '').replace(PREFIX_TOKENS, '');
  return trimmed.length > 0 ? trimmed : name.trim();
}

export function makeTeamRef(name: string): TeamRef {
  return { name, short: shortTeamName(name), key: teamKey(name) };
}

/**
 * Similarity of two club names in [0, 1], tolerant to the naming differences
 * between providers ("Manchester United FC" vs "Manchester United", "Bayern München" vs "Bayern Munich").
 */
export function teamSimilarity(a: string, b: string): number {
  const ta = new Set(identityTokens(a));
  const tb = new Set(identityTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const overlap = shared / Math.min(ta.size, tb.size);
  const jaccard = shared / (ta.size + tb.size - shared);
  return 0.6 * overlap + 0.4 * jaccard;
}

export const TEAM_MATCH_THRESHOLD = 0.55;
