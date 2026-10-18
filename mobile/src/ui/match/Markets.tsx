import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { confidenceForMarket } from '@/engine/assessment';
import { MARKET_GROUPS, type MarketGroup, type SelectionEstimate } from '@/engine/markets';
import type { Msg } from '@/i18n';
import { selectionScope } from '@/engine/settlement';
import { marketSkill } from '@/engine/validation';
import { useT } from '@/hooks/useT';
import { selectionLabel } from '@/i18n';
import type { MatchAnalysis } from '@/services/analysis';
import { useSettings } from '@/state/settings';
import { useSlip } from '@/state/slip';
import { Card, Chip, Icon, Row, TextButton, Txt } from '../components/primitives';
import { ConfidenceBadge, EvBadge, ProbBar } from '../components/probability';
import { StateView } from '../components/states';
import { dateTimeText, oddsText, pct } from '../format';
import { colors, space } from '../theme';
import { Bullets, useQuoteViews, type QuoteView } from './shared';

type FreqKey = 'over15' | 'over25' | 'over35' | 'btts';

/** Recent-match frequencies relevant to a market group, straight from the source results. */
function supportFor(group: MarketGroup, a: MatchAnalysis): Msg[] {
  const h = a.home;
  const w = a.away;
  if (!h || !w || h.last10Freq.sample === 0 || w.last10Freq.sample === 0) return [];
  const count = (s: typeof h, k: FreqKey) => Math.round(s.last10Freq[k] * s.last10Freq.sample);
  const freq = (key: 'why.overFrequency' | 'why.bttsFrequency', k: FreqKey, line?: number): Msg => ({
    key,
    params: { line: line ?? '', home: h.name, hk: count(h, k), hn: h.last10Freq.sample, away: w.name, ak: count(w, k), an: w.last10Freq.sample },
  });
  switch (group) {
    case 'goals':
    case 'team_goals':
      return [freq('why.overFrequency', 'over15', 1.5), freq('why.overFrequency', 'over25', 2.5), freq('why.overFrequency', 'over35', 3.5)];
    case 'btts':
      return [freq('why.bttsFrequency', 'btts')];
    default:
      return (a.explanation?.sections.find((s) => s.id === 'support')?.items ?? []).slice(0, 3);
  }
}

function OutcomeBreakdown({ est }: { est: SelectionEstimate }) {
  const { t } = useT();
  const d = est.dist;
  const parts = (['win', 'half_win', 'push', 'half_loss', 'loss'] as const).filter((k) => d[k] > 0.0005).map((k) => `${t(`outcome.${k}`)} ${pct(d[k], 1)}`);
  return (
    <Txt variant="caption" color={colors.textMuted}>
      {parts.join(' • ')}
    </Txt>
  );
}

function SelectionRow({ est, analysis, quote, onEnterOdds }: { est: SelectionEstimate; analysis: MatchAnalysis; quote?: QuoteView; onEnterOdds: (key: string) => void }) {
  const { t, lang } = useT();
  const zone = useSettings((s) => s.timezone);
  const hideBetting = useSettings((s) => s.hideBetting);
  const showFair = useSettings((s) => s.showFairOdds);
  const slip = useSlip();
  const { fixture, prediction } = analysis;
  const confidence = prediction ? confidenceForMarket(prediction.confidence, selectionScope(est.selection), est.group) : null;
  const inSlip = slip.legs.some((l) => l.fixtureId === fixture.id && l.selectionKey === est.key);
  const canAdd = fixture.status === 'scheduled' && !hideBetting;
  const label = selectionLabel(lang, est.selection, fixture.home.short, fixture.away.short);
  const usableQuote = quote && quote.state === 'ok' ? quote : undefined;

  return (
    <View style={{ gap: 4, paddingVertical: space.xs }} testID={`sel-${est.key}`}>
      <ProbBar label={label} p={est.probability} uncertain={confidence?.level === 'low'} right={showFair ? oddsText(1 / Math.max(est.probability, 1e-9)) : undefined} />
      {!est.binary ? <OutcomeBreakdown est={est} /> : null}
      {!hideBetting ? (
        quote ? (
          <Row style={{ flexWrap: 'wrap' }} gap={6}>
            <Txt variant="caption" color={colors.textSecondary}>
              {t('common.odds')} {oddsText(quote.quote.decimal)} • {quote.quote.provider === 'manual' ? t('odds.manual') : quote.quote.bookmaker} • {dateTimeText(quote.quote.quotedAt, zone)} • {t('metric.implied')} {pct(quote.implied, 1)}
            </Txt>
            {quote.state === 'ok' ? <EvBadge ev={quote.ev} /> : <Txt variant="caption" color={colors.warning}>{quote.state === 'stale' ? t('odds.stale') : t('odds.kickoffPassed')}</Txt>}
          </Row>
        ) : (
          <Txt variant="caption" color={colors.textMuted}>
            {t('odds.unavailable')}
          </Txt>
        )
      ) : null}
      {!hideBetting && fixture.status === 'scheduled' ? (
        <Row gap={space.md}>
          <TextButton
            onPress={() =>
              inSlip
                ? slip.remove(fixture.id, est.key)
                : slip.add({
                    fixtureId: fixture.id,
                    competition: fixture.competition,
                    home: fixture.home.short,
                    away: fixture.away.short,
                    kickoffUtc: fixture.kickoffUtc,
                    matchDate: fixture.sourceDate,
                    selectionKey: est.key,
                    probability: est.binary ? est.probability : null,
                    odds: usableQuote?.quote.decimal ?? null,
                    oddsProvider: usableQuote?.quote.provider ?? null,
                    oddsBookmaker: usableQuote?.quote.bookmaker ?? null,
                    oddsQuotedAt: usableQuote?.quote.quotedAt ?? null,
                  })
            }
            disabled={!canAdd}
            label={inSlip ? t('match.inSlip') : t('match.addToSlip')}
            icon={inSlip ? 'checkmark-circle' : 'add-circle-outline'}
            testID={`add-${est.key}`}
          />
          <TextButton onPress={() => onEnterOdds(est.key)} label={t('match.enterOdds')} icon="create-outline" testID={`odds-${est.key}`} />
        </Row>
      ) : null}
    </View>
  );
}

export function Markets({ analysis, onEnterOdds }: { analysis: MatchAnalysis; onEnterOdds: (key: string) => void }) {
  const { t, tm } = useT();
  const [group, setGroup] = useState<MarketGroup>('result');
  const { map: quotes } = useQuoteViews(analysis);
  const p = analysis.prediction;
  if (!p) return null;
  const g = p.book[group];
  const firstScope = g.selections[0] ? selectionScope(g.selections[0].selection) : 'ft';
  const groupConfidence = confidenceForMarket(p.confidence, firstScope, group);
  const skill = marketSkill(group);
  const failure = analysis.explanation?.sections.find((s) => s.id === 'failure')?.items ?? [];

  return (
    <View style={{ gap: space.md }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {MARKET_GROUPS.map((m) => (
          <Chip key={m} label={t(`group.${m}`)} selected={m === group} onPress={() => setGroup(m)} testID={`group-${m}`} />
        ))}
      </ScrollView>

      {!g.available ? (
        <StateView icon="help-circle-outline" title={t('stats.noData')} message={t(`group.unavailable.${g.unavailableReason ?? 'no_data_source'}`)} testID="market-unavailable" />
      ) : (
        <>
          <Card>
            <Row style={{ flexWrap: 'wrap' }} gap={6}>
              <ConfidenceBadge confidence={groupConfidence} />
            </Row>
            {skill.level !== 'untested' && skill.improvement !== null ? (
              <Txt variant="caption" color={skill.level === 'clear' ? colors.textMuted : colors.warning}>
                {t(skill.improvement > 0 ? 'markets.skill' : 'markets.noSkill', { pct: (skill.improvement * 100).toFixed(1), n: skill.matches })}
              </Txt>
            ) : (
              <Txt variant="caption" color={colors.textMuted}>
                {t('conf.marketUntested')}
              </Txt>
            )}
            {group === 'halftime' ? (
              <Txt variant="caption" color={colors.textMuted}>
                {t('markets.htftNote')}
              </Txt>
            ) : null}
            {g.selections.map((est, i) => (
              <View key={est.key}>
                {i > 0 && est.selection.market !== g.selections[i - 1]?.selection.market ? (
                  <Txt variant="caption" color={colors.textMuted} style={{ marginTop: space.sm }}>
                    {t(`market.${est.selection.market}`)}
                  </Txt>
                ) : i === 0 ? (
                  <Txt variant="caption" color={colors.textMuted}>
                    {t(`market.${est.selection.market}`)}
                  </Txt>
                ) : null}
                <SelectionRow est={est} analysis={analysis} quote={quotes.get(est.key)} onEnterOdds={onEnterOdds} />
              </View>
            ))}
            <Txt variant="caption" color={colors.textMuted}>
              {t('odds.settlementHint')}
            </Txt>
          </Card>
          <Card>
            <Txt variant="bodyStrong">{t('markets.support')}</Txt>
            {supportFor(group, analysis).length ? <Bullets items={supportFor(group, analysis)} icon="checkmark-circle-outline" /> : <Txt variant="small" color={colors.textMuted}>{t('exp.noSupport')}</Txt>}
          </Card>
          <Card>
            <Row gap={6}>
              <Icon name="alert-circle-outline" size={16} color={colors.warning} />
              <Txt variant="bodyStrong">{t('markets.whyFail')}</Txt>
            </Row>
            <Bullets items={[...failure, ...groupConfidence.reasons.slice(0, 3)]} icon="remove-circle-outline" color={colors.warning} />
          </Card>
        </>
      )}
      <Txt variant="caption" color={colors.textMuted}>
        {tm({ key: 'metric.distinctHint' })}
      </Txt>
    </View>
  );
}
