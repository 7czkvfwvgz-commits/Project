import type { FetchLike } from '@/providers/http';

export interface FakeReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: { url: string; headers: Record<string, string> }[];
}

/** Route-based fake fetch; a route may be a reply, a function, or an Error to throw (network failure). */
export function fakeFetch(routes: Record<string, FakeReply | Error | ((headers: Record<string, string>) => FakeReply | Error)>): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = (key ? routes[key] : undefined) ?? { status: 404, body: { message: 'Not Found' } };
    const reply = typeof route === 'function' ? route(headers) : route;
    if (reply instanceof Error) throw reply;
    const text = reply.body === undefined ? '' : typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    const lower = Object.fromEntries(Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: reply.status,
      ok: reply.status >= 200 && reply.status < 300,
      headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
      text: async () => text,
    } as unknown as Response;
  };
  return { fetch: fetchImpl, calls };
}
