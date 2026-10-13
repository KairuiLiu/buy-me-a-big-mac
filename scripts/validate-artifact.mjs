import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { BADGE_LANGUAGES } from '../src/lib/badges.js';
import { giftPath } from '../src/lib/routes.js';

const source = await readFile(new URL('../dist/worker.js', import.meta.url), 'utf8');
const worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.equal(typeof worker.default?.fetch, 'function');
const page = await readFile(new URL('../dist/public/index.html', import.meta.url), 'utf8');
const entry = page.match(/<script\b[^>]*type="module"[^>]*src="(\/assets\/[^"\s]+\.js)"/);
assert.ok(entry, 'built HTML must reference the compiled frontend entry');
assert.equal((await stat(new URL(`../dist/public${entry[1]}`, import.meta.url))).isFile(), true);
assert.doesNotMatch(page, /\/src\/|app\.js/, 'production HTML must not reference uncompiled sources');
assert.match(page, /<meta property="og:image" content="https:[^"]*\/assets\/card-home\.png" \/>/, 'the default shell must preview the project');
for (const badge of BADGE_LANGUAGES) {
  const shell = await readFile(new URL(`../dist/public${giftPath(false, badge.value)}.html`, import.meta.url), 'utf8');
  assert.ok(shell.includes(`content="https://buy-me-a-big-mac.liukairui.me${badge.card}"`), `${badge.value} shell must preview its own badge card`);
  assert.equal(shell.replace(/<!--link-preview-->[\s\S]*<!--\/link-preview-->/, ''), page.replace(/<!--link-preview-->[\s\S]*<!--\/link-preview-->/, ''), 'share shells must only differ in their preview tags');
  assert.equal((await stat(new URL(`../dist/public${badge.card}`, import.meta.url))).isFile(), true);
}
const headers = await readFile(new URL('../dist/public/_headers', import.meta.url), 'utf8');
assert.doesNotMatch(headers, /unsafe-inline|unsafe-eval/, 'production CSP must remain strict');
const response = await worker.default.fetch(new Request('https://example.com/api/mcp', { headers: { 'CF-Connecting-IP': '192.0.2.1' } }), { API_RATE_LIMITER: { limit: async () => ({ success: true }) } });
assert.equal(response.status, 404, 'generic MCP forwarding must stay disabled');
console.log('Artifact is valid ESM; static entry and API boundary verified.');
