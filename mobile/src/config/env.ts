/**
 * Public build-time configuration. EXPO_PUBLIC_* values are inlined into the
 * app bundle and are NOT secret — never put provider API keys here. Keys for
 * football-data.org and The Odds API live only on the proxy server (server/).
 */
function clean(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v.replace(/\/+$/, '') : null;
}

export const PROXY_URL = clean(process.env.EXPO_PUBLIC_PROXY_URL);

/** Optional shared token the proxy can require to deter casual reuse of its quota (not a secret). */
export const PROXY_CLIENT_TOKEN = clean(process.env.EXPO_PUBLIC_PROXY_CLIENT_TOKEN);

export const APP_VERSION = '1.0.0';
