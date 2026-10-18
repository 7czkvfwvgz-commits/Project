import { View } from 'react-native';
import { findEstimate } from '@/engine/markets';
import { topScorelines } from '@/engine/scoreMatrix';
import { useT } from '@/hooks/useT';
import type { MatchAnalysis } from '@/services/analysis';
import { useSettings } from '@/state/settings';
import { ScoreGrid } from '../components/charts';
import { Card, KeyValue, Row, SectionHeader, Txt } from '../components/primitives';
import { ConfidenceBadge, ProbBar, QualityBadge, ThreeWayBar } from '../components/probability';
import { Banner } from '../components/states';
import { agoText, dateTimeText, oddsText, pct, shortDate } from '../format';
import { colors, space } from '../theme';
import { Bullets, useQuoteViews } from './shared';

export function Overview({ analysis }: { analysis: MatchAnalysis }) {
  const { t, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const hideBetting = useSettings((s) => s.hideBetting);
  const showFair = useSettings((s) => s.showFairOdds);
  const { map: quotes, books } = useQuoteViews(analysis);
  const p = analysis.prediction;
  if (!p) return null;
  const prob = (k: string) => findEstimate(p.book, k)?.probability ?? 0;
  const uncertain = p.confidence.level === 'low';
  const fair = (k: string) => (showFair ? oddsText(1 / Math.max(prob(k), 1e-9)) : undefined);
  const { fixture } = analysis;

  return (
    <View style={{ gap: space.md }}>
      {p.fallback !== 'none' ? <Banner tone="warning" text={t(`match.fallback.${p.fallback}`)} /> : null}

      <Card>
        <Txt variant="h2">{t('market.1X2')}</Txt>
        <ThreeWayBar h={prob('1X2:H')} d={prob('1X2:D')} a={prob('1X2:A')} />
        <Row style={{ flexWrap: 'wrap' }} gap={6}>
          <ConfidenceBadge confidence={p.confidence} />
          <QualityBadge quality={p.quality} />
        </Row>
        <Txt variant="caption" color={colors.textMuted}>
          {t('metric.distinctHint')}
        </Txt>
      </Card>

      <Card>
        <Txt variant="h2">{t('match.expectedGoals')}</Txt>
        <Row>
          <Txt variant="title" style={{ flex: 1, textAlign: 'center' }}>
            {p.lambdaHome.toFixed(2)}
          </Txt>
          <Txt variant="h2" color={colors.textMuted}>
            –
          </Txt>
          <Txt variant="title" style={{ flex: 1, textAlign: 'center' }}>
            {p.lambdaAway.toFixed(2)}
          </Txt>
        </Row>
        <Row>
          <Txt variant="caption" color={colors.textSecondary} style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>
            {fixture.home.short}
          </Txt>
          <Txt variant="caption" color={colors.textSecondary} style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>
            {fixture.away.short}
          </Txt>
        </Row>
        <Txt variant="caption" color={colors.textMuted}>
          {t('match.expectedGoalsHint')}
        </Txt>
      </Card>

      <Card>
        <Txt variant="h2">{t('group.goals')}</Txt>
        <ProbBar label={t('sel.over', { line: 1.5 })} p={prob('OU:1.5:O')} uncertain={uncertain} right={fair('OU:1.5:O')} />
        <ProbBar label={t('sel.over', { line: 2.5 })} p={prob('OU:2.5:O')} uncertain={uncertain} right={fair('OU:2.5:O')} />
        <ProbBar label={t('sel.under', { line: 3.5 })} p={prob('OU:3.5:U')} uncertain={uncertain} right={fair('OU:3.5:U')} />
        <ProbBar label={`${t('market.BTTS')}: ${t('sel.yes')}`} p={prob('BTTS:Y')} uncertain={uncertain} right={fair('BTTS:Y')} />
      </Card>

      <Card>
        <Txt variant="h2">{t('match.scoreMatrix')}</Txt>
        <ScoreGrid matrix={p.ft} home={fixture.home.short} away={fixture.away.short} />
        <Txt variant="caption" color={colors.textMuted}>
          {t('match.mostLikely')}: {topScorelines(p.ft, 4).map((s) => `${s.home}-${s.away} (${pct(s.p, 1)})`).join(', ')}
        </Txt>
      </Card>

      {!hideBetting ? (
        <Card>
          <Txt variant="h2">{t('common.odds')}</Txt>
          {quotes.size === 0 ? (
            <>
              <Txt variant="bodyStrong" color={colors.textSecondary} testID="odds-unavailable">
                {t('odds.unavailable')}
              </Txt>
              <Txt variant="small" color={colors.textMuted}>
                {t('odds.unavailableHint')}
              </Txt>
            </>
          ) : (
            <>
              {['1X2:H', '1X2:D', '1X2:A', 'OU:2.5:O', 'OU:2.5:U'].map((k) => {
                const q = quotes.get(k);
                if (!q) return null;
                return (
                  <KeyValue
                    key={k}
                    label={`${k.startsWith('1X2') ? t('market.1X2') : t('market.OU')} ${k.split(':').slice(1).join(' ')}`}
                    value={`${oddsText(q.quote.decimal)}  •  ${q.state === 'ok' && q.ev !== null ? `EV ${(q.ev * 100).toFixed(1)}%` : q.state === 'stale' ? t('odds.stale') : q.state === 'kickoff_passed' ? t('odds.kickoffPassed') : '—'}`}
                    hint={`${q.quote.provider === 'manual' ? t('odds.manual') : q.quote.bookmaker} • ${dateTimeText(q.quote.quotedAt, zone)} • ${t('metric.implied')} ${pct(q.implied, 1)}`}
                  />
                );
              })}
              {books
                .filter((b) => b.keys[0] === '1X2:H')
                .slice(0, 3)
                .map((b) => (
                  <Txt key={`${b.provider}-${b.bookmaker}`} variant="caption" color={colors.textMuted}>
                    {t('metric.margin')} ({b.bookmaker ?? t('odds.manual')}): {pct(b.margin, 1)}
                  </Txt>
                ))}
            </>
          )}
        </Card>
      ) : null}

      <SectionHeader title={t('metric.confidence')} />
      <Card>
        <Txt variant="small" color={colors.textSecondary}>
          {t(`level.${p.confidence.level}`)} • {p.confidence.score}/100
        </Txt>
        {p.confidence.reasons.length ? <Bullets items={p.confidence.reasons} /> : null}
      </Card>
      <SectionHeader title={t('metric.quality')} />
      <Card>
        <Txt variant="small" color={colors.textSecondary}>
          {t(`grade.${p.quality.grade}`)} • {p.quality.score}/100
        </Txt>
        <Bullets items={p.quality.reasons} />
      </Card>

      <Card>
        <Txt variant="caption" color={colors.textMuted}>
          {t('match.modelInfo', { version: p.modelVersion, date: shortDate(p.fitAsOf), rho: p.rho.toFixed(3) })}
        </Txt>
        {p.dataAsOf ? (
          <Txt variant="caption" color={colors.textMuted}>
            {t('fresh.resultsUntil', { date: shortDate(p.dataAsOf) })} • {t('common.updated', { ago: agoText(p.sourceFetchedAt, lang) })}
          </Txt>
        ) : null}
        {analysis.dataset && analysis.dataset.pendingPastFixtures.length > 0 ? (
          <Txt variant="caption" color={colors.warning}>
            {t('fresh.pendingResults', { n: analysis.dataset.pendingPastFixtures.length })}
          </Txt>
        ) : null}
      </Card>
    </View>
  );
}
