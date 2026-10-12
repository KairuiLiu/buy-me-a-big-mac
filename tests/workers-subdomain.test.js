import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureWorkersSubdomain } from '../scripts/prepare-workers-subdomain.mjs';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const TOKEN = 'fake-cloudflare-secret-for-tests';
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/subdomain`;
const ENV = { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_API_TOKEN: TOKEN };
const EXPECTED = 'buy-me-a-big-mac-01234567';
const ok = subdomain => new Response(JSON.stringify({ success: true, result: { subdomain } }), { headers: { 'Content-Type': 'application/json' } });
const error = (status, code = 10007) => new Response(JSON.stringify({ success: false, errors: [{ code, message: `upstream private diagnostic ${TOKEN}` }] }), { status, headers: { 'Content-Type': 'application/json' } });

function transport(responses) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    assert.equal(String(url), ENDPOINT);
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${TOKEN}`);
    assert.ok(['error', 'manual'].includes(options.redirect), 'credentials must never follow a redirect');
    assert.equal(String(url).includes(TOKEN), false);
    assert.equal(String(options.body || '').includes(TOKEN), false);
    calls.push({ method: options.method || 'GET', body: options.body });
    assert.ok(responses.length, 'unexpected request after the scripted response sequence');
    const result = responses.shift();
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, fetchImpl };
}

async function safeRejection(operation) {
  await assert.rejects(operation, failure => {
    assert.ok(failure instanceof Error);
    assert.equal(failure.message.includes(TOKEN), false);
    assert.equal(failure.message.includes('upstream private diagnostic'), false);
    return true;
  });
}

test('keeps the existing account workers.dev subdomain without writing', async () => {
  const mock = transport([ok('existing-account-name')]);
  assert.equal(await ensureWorkersSubdomain({ env: ENV, fetchImpl: mock.fetchImpl }), 'existing-account-name');
  assert.deepEqual(mock.calls, [{ method: 'GET', body: undefined }]);
});

test('creates one deterministic subdomain only after the missing-subdomain error is confirmed', async () => {
  const mock = transport([error(404), ok(EXPECTED)]);
  assert.equal(await ensureWorkersSubdomain({ env: ENV, fetchImpl: mock.fetchImpl }), EXPECTED);
  assert.deepEqual(mock.calls.map(call => call.method), ['GET', 'PUT']);
  assert.deepEqual(JSON.parse(mock.calls[1].body), { subdomain: EXPECTED });
});

test('uses the requested application name when creating a previously missing subdomain', async () => {
  const expected = 'another-app-01234567';
  const mock = transport([error(404), ok(expected)]);
  assert.equal(await ensureWorkersSubdomain({ env: ENV, fetchImpl: mock.fetchImpl, name: 'another-app' }), expected);
  assert.deepEqual(JSON.parse(mock.calls[1].body), { subdomain: expected });
});

test('authentication, authorization and server errors never trigger a write even with error code 10007', async () => {
  for (const status of [401, 403, 500, 502, 504]) {
    const mock = transport([error(status)]);
    await safeRejection(() => ensureWorkersSubdomain({ env: ENV, fetchImpl: mock.fetchImpl }));
    assert.deepEqual(mock.calls.map(call => call.method), ['GET'], `HTTP ${status}`);
  }
});

test('unrecognized errors and malformed lookups do not imply a missing subdomain', async () => {
  for (const response of [
    error(404, 10000),
    error(400, 10000),
    new Response(JSON.stringify({ success: true, result: {} })),
    new Response(JSON.stringify({ success: false, result: null })),
    new Response('upstream private diagnostic ' + TOKEN, { status: 200 }),
    new Error('upstream private diagnostic ' + TOKEN),
  ]) {
    const mock = transport([response]);
    await safeRejection(() => ensureWorkersSubdomain({ env: ENV, fetchImpl: mock.fetchImpl }));
    assert.deepEqual(mock.calls.map(call => call.method), ['GET']);
  }
});

test('an ambiguous PUT is recovered by GET without submitting another PUT', async () => {
  for (const uncertain of [
    new Error('upstream private diagnostic ' + TOKEN),
    error(504, 10000),
    new Response('upstream private diagnostic ' + TOKEN, { status: 200 }),
  ]) {
    const mock = transport([error(404), uncertain, ok(EXPECTED)]);
    assert.equal(await ensureWorkersSubdomain({ env: ENV, fetchImpl: mock.fetchImpl }), EXPECTED);
    assert.deepEqual(mock.calls.map(call => call.method), ['GET', 'PUT', 'GET']);
  }
});

test('recovery preserves a subdomain registered concurrently rather than renaming it', async () => {
  const mock = transport([error(404), error(409, 10000), ok('registered-by-another-deploy')]);
  assert.equal(await ensureWorkersSubdomain({ env: ENV, fetchImpl: mock.fetchImpl }), 'registered-by-another-deploy');
  assert.deepEqual(mock.calls.map(call => call.method), ['GET', 'PUT', 'GET']);
});

test('an unsuccessful recovery stops after one PUT and does not expose upstream diagnostic text', async () => {
  for (const lookup of [error(404), error(503, 10000), new Error('upstream private diagnostic ' + TOKEN)]) {
    const mock = transport([error(404), new Error('upstream private diagnostic ' + TOKEN), lookup]);
    await safeRejection(() => ensureWorkersSubdomain({ env: ENV, fetchImpl: mock.fetchImpl }));
    assert.deepEqual(mock.calls.map(call => call.method), ['GET', 'PUT', 'GET']);
  }
});

test('missing or malformed credentials fail locally with a fixed message', async () => {
  const errors = [];
  for (const env of [
    {}, { CLOUDFLARE_API_TOKEN: TOKEN }, { CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
    { ...ENV, CLOUDFLARE_ACCOUNT_ID: 'not-an-account-id' },
    { ...ENV, CLOUDFLARE_API_TOKEN: '' },
  ]) {
    let calls = 0;
    await assert.rejects(() => ensureWorkersSubdomain({ env, fetchImpl: async () => { calls++; throw new Error('unexpected request'); } }), failure => {
      assert.equal(failure.message.includes(TOKEN), false);
      errors.push(failure.message);
      return true;
    });
    assert.equal(calls, 0);
  }
  assert.equal(new Set(errors).size, 1);
});
