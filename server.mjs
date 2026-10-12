import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createApp } from './worker/index.js';
import { handleApi } from './worker/api.js';
import { handlePayments } from './worker/payments.js';
import { readAssets } from './scripts/assets.mjs';

const preview = process.env.LOCAL_PREVIEW === '1';
const development = preview || process.env.LOCAL_DEV === '1' || process.argv.includes('--dev');
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number');
const origin = `http://127.0.0.1:${port}`;
const app = development ? null : createApp(await readAssets(fileURLToPath(new URL('./dist/public/', import.meta.url))));
let vite;

const server = createServer(async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  try {
    const url = new URL(req.url, origin);
    if (url.origin !== origin || req.headers.host !== url.host) {
      res.writeHead(403).end('Host not allowed');
      return;
    }
    if (preview && url.pathname.startsWith('/api/')) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: '本地设计预览不连接真实服务，请打开 #/preview 查看演示菜单。' }));
      return;
    }
    if (development && !url.pathname.startsWith('/api/')) {
      // These allowances are local-only: Vite injects style updates and uses
      // a same-host WebSocket. Built pages retain the strict production CSP.
      res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' ws://127.0.0.1:${port}; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action https://afdian.com`);
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
      res.setHeader('Cache-Control', 'no-store');
      vite.middlewares(req, res, () => res.writeHead(404).end('Not found'));
      return;
    }
    const options = { method: req.method, headers: req.headers, signal: controller.signal };
    if (!['GET', 'HEAD'].includes(req.method)) Object.assign(options, { body: Readable.toWeb(req), duplex: 'half' });
    const request = new Request(url, options);
    const env = { MCD_TOKEN: preview ? '' : process.env.MCD_TOKEN };
    const response = development
      ? await (url.pathname.startsWith('/api/payments/') ? handlePayments(request, env) : handleApi(request, env))
      : await app.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const body = Readable.fromWeb(response.body);
      body.on('error', () => res.destroy());
      body.pipe(res);
    } else res.end();
  } catch {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('服务暂时不可用，请重试。');
  }
});

if (development) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    server: { middlewareMode: true, ws: { server }, port },
    appType: 'spa',
  });
}

server.listen(port, '127.0.0.1', () => {
  console.log(`Local: ${origin}${preview ? '/#/preview' : '/'}`);
  if (development) console.log(`Svelte + Vite HMR enabled${preview ? ' · demo only, real API disabled' : ''}.`);
});
server.on('error', async error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Could not start local server.');
  await vite?.close();
  process.exitCode = 1;
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await vite?.close();
  server.closeAllConnections();
  server.close();
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
