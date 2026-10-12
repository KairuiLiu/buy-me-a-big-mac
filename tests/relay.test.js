import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp } from '../worker/relay.js';

test('retired generic MCP relay always fails closed without executing fetch', async () => {
  let called = false;
  for (const method of ['GET', 'POST', 'OPTIONS']) {
    const response = await handleMcp(new Request('https://bigmac.example/api/mcp', { method }), { fetchImpl: () => { called = true; } });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(called, false);
});
