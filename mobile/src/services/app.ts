import { PROXY_CLIENT_TOKEN, PROXY_URL } from '@/config/env';
import { getDb } from '@/db';
import { SqliteCacheStore, SqliteManualOdds } from '@/db/repos';
import type { SqlDb } from '@/db/schema';
import { createProviders, type Providers } from '@/providers/registry';

export interface AppServices {
  db: SqlDb;
  cache: SqliteCacheStore;
  manualOdds: SqliteManualOdds;
  providers: Providers;
}

let services: Promise<AppServices> | null = null;

export function getServices(): Promise<AppServices> {
  services ??= (async () => {
    const db = await getDb();
    const cache = new SqliteCacheStore(db);
    const manualOdds = new SqliteManualOdds(db);
    const providers = createProviders({ cache, manualOdds, proxyUrl: PROXY_URL, clientToken: PROXY_CLIENT_TOKEN });
    return { db, cache, manualOdds, providers };
  })().catch((e) => {
    services = null;
    throw e;
  });
  return services;
}

export function resetServicesForTests() {
  services = null;
}
