import type { Fixture } from '@/domain/types';
import type { OddsQuote } from '@/engine/odds';
import { fieldMap, type OddsProvider, type ProviderCapabilities, type ResultMeta } from '../types';

export interface ManualOddsRow {
  selectionKey: string;
  decimal: number;
  enteredAt: number;
}

export interface ManualOddsSource {
  list(fixtureId: string): Promise<ManualOddsRow[]>;
}

/** Prices the user typed in themselves; labelled as such and never attributed to a bookmaker. */
export class ManualOddsProvider implements OddsProvider {
  readonly id = 'manual' as const;

  constructor(private readonly source: ManualOddsSource) {}

  capabilities(): ProviderCapabilities {
    return {
      id: this.id,
      roles: ['odds'],
      fields: fieldMap({ odds_1x2: 'partial', odds_totals: 'partial' }),
      dataKind: 'cached',
      requiresCredentials: false,
      configured: true,
      competitions: [],
      homepage: '',
      terms: 'Entered by the user on this device.',
      attribution: 'Odds entered manually by the user',
    };
  }

  async getOdds(fixture: Fixture): Promise<{ quotes: OddsQuote[]; meta: ResultMeta }> {
    const rows = await this.source.list(fixture.id);
    const quotes: OddsQuote[] = rows.map((r) => ({
      selectionKey: r.selectionKey,
      decimal: r.decimal,
      bookmaker: null,
      provider: 'manual',
      quotedAt: r.enteredAt,
      fetchedAt: r.enteredAt,
    }));
    const latest = rows.reduce((m, r) => Math.max(m, r.enteredAt), 0);
    return { quotes, meta: { provider: this.id, fetchedAt: latest || Date.now(), freshness: 'cached', stale: false } };
  }
}
