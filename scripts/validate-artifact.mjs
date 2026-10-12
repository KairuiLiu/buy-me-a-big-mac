import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../dist/worker.js', import.meta.url), 'utf8');
const worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.equal(typeof worker.default?.fetch, 'function');
const page = await readFile(new URL('../dist/public/index.html', import.meta.url), 'utf8');
assert.match(page, /app\.js/);
const response = await worker.default.fetch(new Request('https://example.com/api/mcp', { headers: { 'CF-Connecting-IP': '192.0.2.1' } }), { API_RATE_LIMITER: { limit: async () => ({ success: true }) } });
assert.equal(response.status, 404, 'generic MCP forwarding must stay disabled');
console.log('Artifact is valid ESM; static entry and API boundary verified.');
