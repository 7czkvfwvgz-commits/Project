import type { ProviderId } from '@/domain/types';

export type ProviderErrorKind =
  | 'network'
  | 'offline'
  | 'timeout'
  | 'rate_limited'
  | 'missing_credentials'
  | 'unauthorized'
  | 'not_found'
  | 'invalid_response'
  | 'server';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: ProviderId;
  readonly status?: number;
  /** Seconds to wait before retrying, when the provider says. */
  readonly retryAfterSec?: number;

  constructor(provider: ProviderId, kind: ProviderErrorKind, message: string, options: { status?: number; retryAfterSec?: number } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.kind = kind;
    this.status = options.status;
    this.retryAfterSec = options.retryAfterSec;
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** Errors that a retry cannot fix. */
export function isRetryable(e: unknown): boolean {
  if (!isProviderError(e)) return true;
  return e.kind === 'network' || e.kind === 'timeout' || e.kind === 'server';
}

export interface ProviderErrorInfo {
  kind: ProviderErrorKind;
  message: string;
  status?: number;
  retryAfterSec?: number;
}

export function toErrorInfo(e: unknown): ProviderErrorInfo {
  if (isProviderError(e)) return { kind: e.kind, message: e.message, status: e.status, retryAfterSec: e.retryAfterSec };
  return { kind: 'network', message: e instanceof Error ? e.message : String(e) };
}

export function errorKindForStatus(status: number): ProviderErrorKind {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  return 'server';
}
