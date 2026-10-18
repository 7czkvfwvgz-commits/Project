import { expectedGoalsFor, fitLeagueModel, GLOBAL_DEFAULT_RATES } from '@/engine/fit';
import { predictMatch } from '@/engine/predict';
import { makeTeams, mulberry32, pearson, syntheticLeague } from '../test-utils/synthetic';

const NOW = Date.UTC(2026, 9, 18, 12);

describe('Dixon-Coles fit on a synthetic league with known parameters', () => {
  const rng = mulberry32(42);
  const teams = makeTeams(20, rng);
  const { dataset } = syntheticLeague(
    [
      { season: '2024-25', start: '2024-08-17', teams, playedRounds: 38 },
      { season: '2025-26', start: '2025-08-16', teams, playedRounds: 38 },
    ],
    1.3,
    7,
  );
  const model = fitLeagueModel(dataset, '2026-07-01', '2025-26', { halfLifeDays: 10_000, priorMatches: 1 });

  it('recovers attack and defence ratings', () => {
    const keys = teams.map((t) => t.key);
    const estAttack = keys.map((k) => model.ratings[k]!.attack);
    const estDefence = keys.map((k) => model.ratings[k]!.defence);
    expect(pearson(estAttack, teams.map((t) => t.attack))).toBeGreaterThan(0.85);
    expect(pearson(estDefence, teams.map((t) => t.defence))).toBeGreaterThan(0.75);
  });

  it('recovers home advantage and finds ρ near zero for independent data', () => {
    expect(model.homeAdvantage).toBeGreaterThan(1.15);
    expect(model.homeAdvantage).toBeLessThan(1.45);
    expect(model.rhoEstimated).toBe(true);
    expect(Math.abs(model.rho)).toBeLessThan(0.1);
  });

  it('estimates the half-time share of goals', () => {
    expect(model.halfTime).not.toBeNull();
    expect(model.halfTime!.homeShare).toBeGreaterThan(0.4);
    expect(model.halfTime!.homeShare).toBeLessThan(0.5);
  });

  it('identifies the scale: mean attack is 1', () => {
    const attacks = Object.values(model.ratings).map((r) => r.attack);
    expect(attacks.reduce((s, a) => s + a, 0) / attacks.length).toBeCloseTo(1, 6);
  });

  it('gives sensible expected goals', () => {
    const strong = [...teams].sort((a, b) => b.attack / b.defence - a.attack / a.defence)[0]!;
    const weak = [...teams].sort((a, b) => a.attack / a.defence - b.attack / b.defence)[0]!;
    const eg = expectedGoalsFor(model, strong.key, weak.key);
    expect(eg.lambdaHome).toBeGreaterThan(eg.lambdaAway);
    expect(eg.fallback).toBe('none');
  });
});

describe('no future-data leakage', () => {
  it('ignores matches on or after the prediction date', () => {
    const rng = mulberry32(3);
    const teams = makeTeams(10, rng);
    const { dataset } = syntheticLeague([{ season: '2025-26', start: '2025-08-16', teams, playedRounds: 18 }], 1.3, 11);
    const asOf = '2025-11-01';
    const before = fitLeagueModel(dataset, asOf, '2025-26');
    const poisoned = {
      ...dataset,
      matches: [
        ...dataset.matches,
        ...dataset.matches.filter((m) => m.date >= asOf).map((m) => ({ ...m, ft: { home: 9, away: 0 } })),
        { ...dataset.matches[0]!, date: asOf, ft: { home: 12, away: 0 } },
      ],
    };
    const after = fitLeagueModel(poisoned, asOf, '2025-26');
    expect(after.ratings).toEqual(before.ratings);
    expect(after.homeAdvantage).toBe(before.homeAdvantage);
    expect(after.trainingMatches).toBe(before.trainingMatches);
  });
});

describe('newcomers and fallbacks', () => {
  const rng = mulberry32(9);
  const base = makeTeams(18, rng);
  // The three weakest teams are relegated and replaced by three promoted teams.
  const sorted = [...base].sort((a, b) => a.attack / a.defence - b.attack / b.defence);
  const relegated = sorted.slice(0, 3);
  const promoted = makeTeams(3, mulberry32(10), 'Promoted');
  const season2 = [...base.filter((t) => !relegated.includes(t)), ...promoted];
  const { dataset, fixtures } = syntheticLeague(
    [
      { season: '2025-26', start: '2025-08-16', teams: base, playedRounds: 34 },
      { season: '2026-27', start: '2026-08-15', teams: season2, playedRounds: 0 },
    ],
    1.3,
    5,
  );

  it('starts promoted teams from the relegated teams’ average', () => {
    const model = fitLeagueModel(dataset, '2026-08-15', '2026-27');
    for (const p of promoted) {
      const r = model.ratings[p.key]!;
      expect(r.newcomer).toBe(true);
      expect(r.prior).toBe('relegated_teams');
      expect(r.matches).toBe(0);
    }
    // The prior comes from the first-pass ratings; the final pass renormalises the scale slightly.
    const relAttack = Math.exp(relegated.reduce((s, t) => s + Math.log(model.ratings[t.key]!.attack), 0) / 3);
    expect(Math.abs(model.ratings[promoted[0]!.key]!.attack - relAttack)).toBeLessThan(0.05);
    expect(model.ratings[promoted[0]!.key]!.attack).toBeLessThan(1);
  });

  it('reduces confidence for newcomers and the early season', () => {
    const model = fitLeagueModel(dataset, '2026-08-15', '2026-27');
    const fixture = fixtures.find((f) => f.season === '2026-27' && f.home.key === promoted[0]!.key)!;
    const prediction = predictMatch({ fixture, dataset, model, nowMs: NOW, validated: true });
    expect(prediction.issues).toEqual([]);
    expect(prediction.confidence.reasons.map((r) => r.key)).toEqual(expect.arrayContaining(['conf.newcomer', 'conf.earlySeason']));
    expect(prediction.confidence.level).not.toBe('high');
  });

  it('falls back to league averages for an unknown team', () => {
    const model = fitLeagueModel(dataset, '2026-08-15', '2026-27');
    const eg = expectedGoalsFor(model, 'unknown-team', base[0]!.key);
    expect(eg.fallback).toBe('league_average');
    expect(eg.missingTeams).toEqual(['unknown-team']);
  });

  it('uses the documented global default when history is too short', () => {
    const tiny = { ...dataset, matches: dataset.matches.slice(0, 12) };
    const model = fitLeagueModel(tiny, '2026-08-15', '2026-27');
    expect(model.fallback).toBe('global_default');
    const eg = expectedGoalsFor(model, base[3]!.key, base[4]!.key);
    expect(eg.lambdaHome).toBe(GLOBAL_DEFAULT_RATES.home);
    expect(eg.lambdaAway).toBe(GLOBAL_DEFAULT_RATES.away);
    const fixture = fixtures.find((f) => f.season === '2026-27')!;
    const prediction = predictMatch({ fixture, dataset: tiny, model, nowMs: NOW, validated: true });
    expect(prediction.confidence.score).toBeLessThanOrEqual(15);
    expect(prediction.half).toBeNull();
  });

  it('fixes ρ at zero when there are too few matches', () => {
    const small = { ...dataset, matches: dataset.matches.slice(0, 80) };
    const model = fitLeagueModel(small, '2026-08-15', '2026-27');
    expect(model.rhoEstimated).toBe(false);
    expect(model.rho).toBe(0);
  });
});
