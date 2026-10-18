import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHandler, type Env } from './handler.ts';

// Load server/.env when present (Node ≥ 20.12). Keys never leave this process.
if (existsSync('.env')) process.loadEnvFile('.env');

const env: Env = {
  FOOTBALL_DATA_API_KEY: process.env.FOOTBALL_DATA_API_KEY || undefined,
  ODDS_API_KEY: process.env.ODDS_API_KEY || undefined,
  CLIENT_TOKEN: process.env.CLIENT_TOKEN || undefined,
};
const handle = createHandler(env, { fetch: globalThis.fetch, now: Date.now });
const port = Number(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? `localhost:${port}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const forwarded = req.socket.remoteAddress;
    if (forwarded && !headers.has('x-forwarded-for')) headers.set('x-forwarded-for', forwarded);
    const response = await handle(new Request(`http://${host}${req.url ?? '/'}`, { method: req.method, headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}).listen(port, () => {
  console.log(`Proxy listening on http://localhost:${port}`);
  console.log(`football-data.org key: ${env.FOOTBALL_DATA_API_KEY ? 'configured' : 'missing'}; odds key: ${env.ODDS_API_KEY ? 'configured' : 'missing'}`);
});
