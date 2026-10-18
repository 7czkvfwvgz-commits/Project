import type { ProviderId } from '@/domain/types';
import { errorKindForStatus, isRetryable, ProviderError } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  provider: ProviderId;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Additional attempts after the first, for network/timeout/5xx failures only. */
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

async function attempt(url: string, opts: HttpOptions): Promise<HttpResponse> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { headers: opts.headers, signal: controller.signal });
    const text = await res.text();
    if (res.status === 304 || (res.status >= 200 && res.status < 300)) return { status: res.status, headers: res.headers, text };
    const kind = errorKindForStatus(res.status);
    let message = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
      if (body.error === 'missing_credentials') {
        throw new ProviderError(opts.provider, 'missing_credentials', message, { status: res.status });
      }
    } catch (e) {
      if (e instanceof ProviderError) throw e;
    }
    throw new ProviderError(opts.provider, kind, message, { status: res.status, retryAfterSec: parseRetryAfter(res.headers.get('retry-after')) });
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (opts.signal?.aborted) throw e;
    if (controller.signal.aborted) throw new ProviderError(opts.provider, 'timeout', 'Request timed out');
    throw new ProviderError(opts.provider, 'network', e instanceof Error ? e.message : 'Network request failed');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * GET with a timeout and a bounded number of retries with exponential backoff
 * (network errors, timeouts and 5xx only — never 4xx, never rate limits).
 */
export async function httpGet(url: string, opts: HttpOptions): Promise<HttpResponse> {
  const retries = Math.max(0, Math.min(opts.retries ?? 2, 4));
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt(url, opts);
    } catch (e) {
      lastError = e;
      if (!isRetryable(e) || i === retries || opts.signal?.aborted) throw e;
      await sleep((opts.baseDelayMs ?? 500) * 2 ** i);
    }
  }
  throw lastError;
}
