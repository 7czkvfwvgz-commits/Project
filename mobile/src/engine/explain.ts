import type { Fixture } from '@/domain/types';
import type { Msg } from '@/i18n/types';
import { findEstimate } from './markets';
import type { MatchPrediction } from './predict';
import { topScorelines } from './scoreMatrix';
import { pointsPerMatch, type FormEntry, type StandingRow, type TeamSummary } from './teamStats';

/**
 * Rule-based match explanation built only from the model output and the
 * statistics computed from source data. It never introduces facts of its own
 * (injuries, news, odds) and never changes a probability.
 */
export type ExplanationSectionId = 'form' | 'strengths' | 'expected_goals' | 'probabilities' | 'support' | 'conflict' | 'limitations' | 'failure';

export interface Explanation {
  generator: 'rules';
  sections: { id: ExplanationSectionId; items: Msg[] }[];
}

export interface ExplainInput {
  fixture: Fixture;
  prediction: MatchPrediction;
  home: TeamSummary;
  away: TeamSummary;
  standings: StandingRow[];
  h2h: FormEntry[];
}

const pct = (p: number) => Math.round(p * 100);
const f2 = (n: number) => n.toFixed(2);
const formCodes = (entries: FormEntry[]) => entries.map((e) => e.result).join('');
const points = (entries: FormEntry[]) => entries.reduce((s, e) => s + (e.result === 'W' ? 3 : e.result === 'D' ? 1 : 0), 0);

export function explainMatch(input: ExplainInput): Explanation {
  const { prediction: p, home, away } = input;
  const prob = (k: string) => findEstimate(p.book, k)?.probability ?? 0;
  const sections: Explanation['sections'] = [];

  // Recent form
  const form: Msg[] = [];
  for (const t of [home, away]) {
    if (t.last5.length === 0) {
      form.push({ key: 'exp.noForm', params: { team: t.name } });
      continue;
    }
    const gf = t.last5.reduce((s, e) => s + e.gf, 0);
    const ga = t.last5.reduce((s, e) => s + e.ga, 0);
    form.push({ key: 'exp.form', params: { team: t.name, n: t.last5.length, form: formCodes(t.last5), gf, ga, pts: points(t.last5) } });
  }
  if (home.home.played > 0) form.push({ key: 'exp.homeRecord', params: { team: home.name, w: home.home.won, d: home.home.drawn, l: home.home.lost, ppm: f2(pointsPerMatch(home.home)) } });
  if (away.away.played > 0) form.push({ key: 'exp.awayRecord', params: { team: away.name, w: away.away.won, d: away.away.drawn, l: away.away.lost, ppm: f2(pointsPerMatch(away.away)) } });
  sections.push({ id: 'form', items: form });

  // Attack and defence relative to the league average
  const strengths: Msg[] = [];
  const level = p.defenceLevel || 1;
  for (const [t, r] of [[home, p.ratings.home], [away, p.ratings.away]] as const) {
    if (!r) {
      strengths.push({ key: 'exp.noRating', params: { team: t.name } });
      continue;
    }
    strengths.push({ key: 'exp.rating', params: { team: t.name, att: f2(r.attack), def: f2(r.defence / level), n: r.effectiveMatches.toFixed(1) } });
  }
  strengths.push({ key: 'exp.homeAdvantage', params: { g: f2(p.homeAdvantage) } });
  sections.push({ id: 'strengths', items: strengths });

  // Expected goals from the model (not shot-based xG)
  sections.push({
    id: 'expected_goals',
    items: [
      { key: 'exp.lambda', params: { home: home.name, lh: f2(p.lambdaHome), away: away.name, la: f2(p.lambdaAway), total: f2(p.lambdaHome + p.lambdaAway) } },
      { key: 'exp.leagueAverage', params: { h: f2(p.leagueAverages.home), a: f2(p.leagueAverages.away) } },
      { key: 'exp.noShotXg' },
    ],
  });

  // Key probabilities
  const top = topScorelines(p.ft, 1)[0];
  sections.push({
    id: 'probabilities',
    items: [
      { key: 'exp.1x2', params: { h: pct(prob('1X2:H')), d: pct(prob('1X2:D')), a: pct(prob('1X2:A')) } },
      { key: 'exp.totals', params: { o15: pct(prob('OU:1.5:O')), o25: pct(prob('OU:2.5:O')), u35: pct(prob('OU:3.5:U')) } },
      { key: 'exp.btts', params: { y: pct(prob('BTTS:Y')) } },
      ...(top ? [{ key: 'exp.topScore' as const, params: { s: `${top.home}-${top.away}`, p: pct(top.p) } }] : []),
    ],
  });

  // Supporting and conflicting evidence for the model's main leans
  const support: Msg[] = [];
  const conflict: Msg[] = [];
  const lean = (['H', 'D', 'A'] as const).map((k) => ({ k, p: prob(`1X2:${k}`) })).sort((a, b) => b.p - a.p)[0] as { k: 'H' | 'D' | 'A'; p: number };
  const hPts5 = home.last5.length ? points(home.last5) / home.last5.length : null;
  const aPts5 = away.last5.length ? points(away.last5) / away.last5.length : null;
  if (lean.k !== 'D' && hPts5 !== null && aPts5 !== null) {
    const favoured = lean.k === 'H' ? home : away;
    const other = lean.k === 'H' ? away : home;
    const favPts = lean.k === 'H' ? hPts5 : aPts5;
    const otherPts = lean.k === 'H' ? aPts5 : hPts5;
    if (favPts >= otherPts) support.push({ key: 'exp.formAgrees', params: { team: favoured.name, a: f2(favPts), b: f2(otherPts), other: other.name } });
    else conflict.push({ key: 'exp.formDisagrees', params: { team: other.name, a: f2(otherPts), b: f2(favPts), fav: favoured.name } });
  }
  const pos = (key: string) => input.standings.find((r) => r.team === key);
  const hp = pos(home.key);
  const ap = pos(away.key);
  if (hp && ap && hp.played > 0 && ap.played > 0) {
    const better = hp.position < ap.position ? 'H' : 'A';
    const msg: Msg = { key: 'exp.table', params: { home: home.name, hp: hp.position, away: away.name, ap: ap.position } };
    if (lean.k === 'D' || better === lean.k) support.push(msg);
    else conflict.push(msg);
  }
  const over = prob('OU:2.5:O');
  const freq = (home.last10Freq.over25 * home.last10Freq.sample + away.last10Freq.over25 * away.last10Freq.sample) /
    Math.max(1, home.last10Freq.sample + away.last10Freq.sample);
  if (home.last10Freq.sample + away.last10Freq.sample > 0) {
    const msg: Msg = { key: 'exp.over25Recent', params: { recent: pct(freq), model: pct(over) } };
    if ((over >= 0.5) === (freq >= 0.5)) support.push(msg);
    else conflict.push(msg);
  }
  if (input.h2h.length > 0) {
    const w = input.h2h.filter((e) => e.result === 'W').length;
    const d = input.h2h.filter((e) => e.result === 'D').length;
    const l = input.h2h.filter((e) => e.result === 'L').length;
    const h2hLean = w > l ? 'H' : l > w ? 'A' : 'D';
    const msg: Msg = { key: 'exp.h2h', params: { n: input.h2h.length, w, d, l, team: home.name } };
    if (h2hLean === lean.k) support.push(msg);
    else conflict.push(msg);
  }
  if (support.length === 0) support.push({ key: 'exp.noSupport' });
  if (conflict.length === 0) conflict.push({ key: 'exp.noConflict' });
  sections.push({ id: 'support', items: support });
  sections.push({ id: 'conflict', items: conflict });

  sections.push({
    id: 'limitations',
    items: [...p.quality.reasons, ...p.confidence.reasons, { key: 'exp.noLineups' }],
  });

  const failure: Msg[] = [{ key: 'exp.failDraw', params: { d: pct(prob('1X2:D')) } }, { key: 'exp.failUnknowns' }, { key: 'exp.failVariance' }];
  if (p.ratings.home?.newcomer || p.ratings.away?.newcomer) failure.push({ key: 'exp.failNewcomer' });
  sections.push({ id: 'failure', items: failure });

  return { generator: 'rules', sections };
}
