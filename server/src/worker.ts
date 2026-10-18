import { createHandler, type Env } from './handler.ts';

// Cloudflare Workers entry point. Keys are configured with `wrangler secret put`.
let handler: ReturnType<typeof createHandler> | null = null;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    handler ??= createHandler(env, { fetch: (input, init) => fetch(input, init), now: Date.now });
    return handler(request);
  },
};
