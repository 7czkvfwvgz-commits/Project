import type { ProviderId } from '@/domain/types';
import { isProviderError, ProviderError, toErrorInfo, type ProviderErrorInfo } from './errors';
import { httpGet, type HttpOptions } from './http';

export interface CacheEntry {
  key: string;
  payload: string;
  fetchedAt: number;
  etag: string | null;
  provider: ProviderId;
  /** True when the source answered 404, so the absence itself is cached. */
  absent: boolean;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | null>;
  set(entry: CacheEntry): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<{ entries: number; bytes: number }>;
}

export class MemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, CacheEntry>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(entry: CacheEntry) {
    this.map.set(entry.key, entry);
  }
  async clear() {
    this.map.clear();
  }
  async stats() {
    let bytes = 0;
    for (const e of this.map.values()) bytes += e.payload.length;
    return { entries: this.map.size, bytes };
  }
}

export interface CachedResult<T> {
  data: T | null;
  /** The source reported the resource does not exist (e.g. a season not yet published). */
  absent: boolean;
  fetchedAt: number;
  fromCache: boolean;
  /** Served from cache after a failed refresh. */
  stale: boolean;
  error?: ProviderErrorInfo;
}

export interface CachedFetchOptions<T> extends Omit<HttpOptions, 'headers'> {
  url: string;
  cacheKey?: string;
  ttlMs: number;
  /** How long a 404 is remembered. */
  absentTtlMs?: number;
  headers?: Record<string, string>;
  parse: (json: unknown) => T;
  now?: () => number;
  /** Bypass the TTL (pull-to-refresh); conditional requests still apply. */
  force?: boolean;
}

const inFlight = new Map<string, Promise<CachedResult<unknown>>>();

/**
 * Cache-first JSON fetch:
 *  - fresh entries (younger than ttl) are returned without a request;
 *  - older entries are revalidated with If-None-Match (304 keeps the payload);
 *  - when the refresh fails, the cached payload is returned marked `stale`;
 *  - concurrent requests for the same key share one network call.
 */
export function cachedFetchJson<T>(store: CacheStore, opts: CachedFetchOptions<T>): Promise<CachedResult<T>> {
  const key = opts.cacheKey ?? opts.url;
  const existing = inFlight.get(key);
  if (existing && !opts.force) return existing as Promise<CachedResult<T>>;
  const p = run(store, key, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, p as Promise<CachedResult<unknown>>);
  return p;
}

async function run<T>(store: CacheStore, key: string, opts: CachedFetchOptions<T>): Promise<CachedResult<T>> {
  const now = opts.now ?? Date.now;
  const cached = await store.get(key).catch(() => null);
  const age = cached ? now() - cached.fetchedAt : Infinity;
  const ttl = cached?.absent ? (opts.absentTtlMs ?? opts.ttlMs) : opts.ttlMs;

  const fromEntry = (entry: CacheEntry, extra: Partial<CachedResult<T>>): CachedResult<T> => {
    if (entry.absent) return { data: null, absent: true, fetchedAt: entry.fetchedAt, fromCache: true, stale: false, ...extra };
    return { data: opts.parse(JSON.parse(entry.payload)), absent: false, fetchedAt: entry.fetchedAt, fromCache: true, stale: false, ...extra };
  };

  if (cached && age < ttl && !opts.force) return fromEntry(cached, {});

  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (cached?.etag && !cached.absent) headers['If-None-Match'] = cached.etag;

  try {
    const res = await httpGet(opts.url, { ...opts, headers });
    const fetchedAt = now();
    if (res.status === 304 && cached) {
      await store.set({ ...cached, fetchedAt }).catch(() => undefined);
      return fromEntry({ ...cached, fetchedAt }, { fromCache: false });
    }
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new ProviderError(opts.provider, 'invalid_response', 'Response is not valid JSON');
    }
    let data: T;
    try {
      data = opts.parse(json);
    } catch (e) {
      throw new ProviderError(opts.provider, 'invalid_response', e instanceof Error ? e.message.slice(0, 300) : 'Validation failed');
    }
    await store
      .set({ key, payload: res.text, fetchedAt, etag: res.headers.get('etag'), provider: opts.provider, absent: false })
      .catch(() => undefined);
    return { data, absent: false, fetchedAt, fromCache: false, stale: false };
  } catch (e) {
    if (isProviderError(e) && e.kind === 'not_found') {
      const fetchedAt = now();
      await store.set({ key, payload: '', fetchedAt, etag: null, provider: opts.provider, absent: true }).catch(() => undefined);
      return { data: null, absent: true, fetchedAt, fromCache: false, stale: false };
    }
    if (cached) {
      try {
        return fromEntry(cached, { stale: true, error: toErrorInfo(e) });
      } catch {
        // A cached payload that no longer validates is useless; surface the original error.
      }
    }
    throw e;
  }
}
