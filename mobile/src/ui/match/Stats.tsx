import { View } from 'react-native';
import { pointsPerMatch, type Record3, type TeamSummary } from '@/engine/teamStats';
import { useT } from '@/hooks/useT';
import type { MatchAnalysis } from '@/services/analysis';
import { GoalsChart } from '../components/charts';
import { Card, Icon, KeyValue, Row, SectionHeader, Txt } from '../components/primitives';
import { FormRow } from '../components/probability';
import { pct, shortDate } from '../format';
import { colors, space } from '../theme';

const PROVIDER_NAMES: Record<string, string> = { openfootball: 'openfootball', 'football-data': 'football-data.org' };

const record = (r: Record3) => `${r.won}-${r.drawn}-${r.lost} • ${r.gf}:${r.ga}`;

function TeamCard({ team, venue }: { team: TeamSummary; venue: 'home' | 'away' }) {
  const { t } = useT();
  const f10 = team.last10Freq;
  const fs = team.seasonFreq;
  return (
    <Card>
      <Txt variant="h2">{team.name}</Txt>
      {team.last5.length === 0 ? (
        <Txt variant="small" color={colors.textMuted}>
          {t('stats.noData')}
        </Txt>
      ) : (
        <>
          <Row>
            <Txt variant="caption" color={colors.textMuted} style={{ width: 80 }}>
              {t('stats.last5')}
            </Txt>
            <FormRow results={team.last5.map((e) => e.result)} />
          </Row>
          <Row>
            <Txt variant="caption" color={colors.textMuted} style={{ width: 80 }}>
              {t('stats.last10')}
            </Txt>
            <FormRow results={team.last10.map((e) => e.result)} />
          </Row>
          <GoalsChart entries={team.last10} />
          <KeyValue label={`${t('stats.season')} (${t('stats.record')})`} value={record(team.overall)} hint={`${t('stats.ppm')}: ${pointsPerMatch(team.overall).toFixed(2)}`} />
          <KeyValue label={t('stats.homeForm')} value={record(team.home)} hint={`${t('stats.ppm')}: ${pointsPerMatch(team.home).toFixed(2)}${venue === 'home' ? ' ★' : ''}`} />
          <KeyValue label={t('stats.awayForm')} value={record(team.away)} hint={`${t('stats.ppm')}: ${pointsPerMatch(team.away).toFixed(2)}${venue === 'away' ? ' ★' : ''}`} />
          <KeyValue
            label={t('stats.goalsAvg')}
            value={team.overall.played ? `${(team.overall.gf / team.overall.played).toFixed(2)} / ${(team.overall.ga / team.overall.played).toFixed(2)}` : '—'}
          />
          <Row style={{ marginTop: space.xs }}>
            <Txt variant="caption" color={colors.textMuted} style={{ flex: 2 }} />
            <Txt variant="caption" color={colors.textMuted} style={{ flex: 1, textAlign: 'right' }}>
              {t('stats.last10')} ({f10.sample})
            </Txt>
            <Txt variant="caption" color={colors.textMuted} style={{ flex: 1, textAlign: 'right' }}>
              {t('stats.season')} ({fs.sample})
            </Txt>
          </Row>
          {(
            [
              ['stats.cleanSheets', 'cleanSheets'],
              ['stats.failedToScore', 'failedToScore'],
              ['stats.btts', 'btts'],
              ['stats.over15', 'over15'],
              ['stats.over25', 'over25'],
              ['stats.over35', 'over35'],
            ] as const
          ).map(([label, key]) => (
            <Row key={key}>
              <Txt variant="small" color={colors.textSecondary} style={{ flex: 2 }}>
                {t(label)}
              </Txt>
              <Txt variant="number" style={{ flex: 1, textAlign: 'right' }}>
                {pct(f10[key])}
              </Txt>
              <Txt variant="number" style={{ flex: 1, textAlign: 'right' }}>
                {fs.sample ? pct(fs[key]) : '—'}
              </Txt>
            </Row>
          ))}
          {team.halves.sample > 0 ? (
            <KeyValue
              label={t('stats.halves')}
              value={`${team.halves.firstHalfGf}:${team.halves.firstHalfGa} / ${team.halves.secondHalfGf}:${team.halves.secondHalfGa}`}
              hint={t('common.sampleSize', { n: team.halves.sample })}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}

export function Stats({ analysis }: { analysis: MatchAnalysis }) {
  const { t } = useT();
  const { home, away, standings, h2h, fixture } = analysis;
  const keys = [fixture.home.key, fixture.away.key];
  return (
    <View style={{ gap: space.md }}>
      {home ? <TeamCard team={home} venue="home" /> : null}
      {away ? <TeamCard team={away} venue="away" /> : null}

      {standings && standings.rows.length > 0 ? (
        <>
          <SectionHeader title={standings.official ? `${t('stats.position')} (football-data.org)` : t('stats.table')} />
          <Card>
            {!standings.official ? (
              <Txt variant="caption" color={colors.textMuted}>
                {t('stats.tableHint')}
              </Txt>
            ) : null}
            <Row>
              <Txt variant="caption" color={colors.textMuted} style={{ width: 24 }}>
                #
              </Txt>
              <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }} />
              {['stats.played', 'stats.gd', 'stats.points'].map((k) => (
                <Txt key={k} variant="caption" color={colors.textMuted} style={{ width: 36, textAlign: 'right' }}>
                  {t(k as 'stats.played')}
                </Txt>
              ))}
            </Row>
            {standings.rows.map((r) => {
              const mine = keys.includes(r.team);
              return (
                <Row key={r.team} style={mine ? { backgroundColor: colors.accentSoft, borderRadius: 6 } : undefined}>
                  <Txt variant="caption" dense style={{ width: 24 }}>
                    {r.position}
                  </Txt>
                  <Txt variant="small" dense style={{ flex: 1 }} numberOfLines={1} color={mine ? colors.text : colors.textSecondary}>
                    {r.name}
                  </Txt>
                  <Txt variant="caption" dense style={{ width: 36, textAlign: 'right' }}>
                    {r.played}
                  </Txt>
                  <Txt variant="caption" dense style={{ width: 36, textAlign: 'right' }}>
                    {r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}
                  </Txt>
                  <Txt variant="caption" dense style={{ width: 36, textAlign: 'right' }}>
                    {r.points}
                  </Txt>
                </Row>
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionHeader title={t('stats.h2h')} />
      <Card>
        <Txt variant="caption" color={colors.textMuted}>
          {t('stats.h2hHint')}
        </Txt>
        {h2h.length === 0 ? (
          <Txt variant="small" color={colors.textMuted}>
            {t('stats.noH2h')}
          </Txt>
        ) : (
          h2h.slice(0, 8).map((e) => (
            <Row key={`${e.date}-${e.venue}`}>
              <Txt variant="caption" color={colors.textMuted} style={{ width: 84 }}>
                {shortDate(e.date)}
              </Txt>
              <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>
                {e.venue === 'H' ? `${fixture.home.short} – ${e.opponentName}` : `${e.opponentName} – ${fixture.home.short}`}
              </Txt>
              <Txt variant="number">{e.venue === 'H' ? `${e.gf}:${e.ga}` : `${e.ga}:${e.gf}`}</Txt>
            </Row>
          ))
        )}
      </Card>

      <SectionHeader title={t('stats.advanced')} />
      <Card testID="advanced-data">
        {(
          [
            ['stats.xg', 'xg'],
            ['stats.shots', 'shots'],
            ['stats.corners', 'corners'],
            ['stats.cards', 'cards'],
            ['stats.lineups', 'lineups'],
            ['stats.injuries', 'injuries'],
          ] as const
        ).map(([label, field]) => (
          <Row key={field} style={{ alignItems: 'flex-start' }}>
            <Icon name="remove-circle-outline" size={14} color={colors.neutral} style={{ marginTop: 3 }} />
            <View style={{ flex: 1 }}>
              <Txt variant="small">{t(label)}</Txt>
              <Txt variant="caption" color={colors.textMuted}>
                {analysis.advanced.unavailable.includes(field) ? t('stats.advancedUnavailable') : '—'}
              </Txt>
            </View>
          </Row>
        ))}
        <Txt variant="caption" color={colors.textMuted}>
          {t('stats.checkedProviders', { providers: analysis.advanced.checked.map((p) => PROVIDER_NAMES[p] ?? p).join(', ') })}
        </Txt>
      </Card>
    </View>
  );
}
