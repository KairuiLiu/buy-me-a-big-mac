import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createApp } from './worker/index.js';
import { readAssets } from './scripts/assets.mjs';

const app = createApp(await readAssets(fileURLToPath(new URL('./public/', import.meta.url))));
const port = Number(process.env.PORT || 4173);
const server = createServer(async (req, res) => {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.host !== `127.0.0.1:${port}` || req.headers.host !== url.host) {
      res.writeHead(403).end('Host not allowed');
      return;
    }
    const options = { method: req.method, headers: req.headers, signal: controller.signal };
    if (!['GET', 'HEAD'].includes(req.method)) Object.assign(options, { body: Readable.toWeb(req), duplex: 'half' });
    const response = await app.fetch(new Request(url, options), { MCD_TOKEN: process.env.MCD_TOKEN });
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
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
