import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preparePaymentsDeploy } from '../scripts/prepare-payments-deploy.mjs';

const database = { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'payment-test' };
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'test-only-secret' };
const response = (result, status = 200) => Response.json({ success: status === 200, result }, { status });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bigmac-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify({
    main: 'worker/cloudflare.js', assets: { directory: './public' },
    d1_databases: [{ binding: 'PAYMENTS_DB', database_name: database.name, database_id: 'placeholder' }],
  }));
  return root;
}

test('deployment reuses existing database and never puts API credentials in generated config', async t => {
  const root = await fixture(t);
  const calls = [];
  const result = await preparePaymentsDeploy({ root, env, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return response([database]);
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
  const source = await readFile(result.configPath, 'utf8');
  assert.ok(!source.includes(env.CLOUDFLARE_API_TOKEN));
  const config = JSON.parse(source);
  assert.equal(config.d1_databases[0].database_id, database.uuid);
  assert.equal(config.main, join(root, 'worker/cloudflare.js'));
  assert.equal(config.d1_databases[0].migrations_dir, join(root, 'migrations'));
  assert.equal(JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8')).d1_databases[0].database_id, 'placeholder');
});

test('deployment creates only a missing database, in APAC without read replicas', async t => {
  const root = await fixture(t);
  let calls = 0;
  await preparePaymentsDeploy({ root, env, fetchImpl: async (_url, options) => {
    calls++;
    if (!options.method) return response([]);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { name: database.name, primary_location_hint: 'apac', read_replication: { mode: 'disabled' } });
    return response(database);
  } });
  assert.equal(calls, 2);
});

test('unknown create outcome is recovered by lookup without a second create', async t => {
  const root = await fixture(t);
  let calls = 0;
  await preparePaymentsDeploy({ root, env, fetchImpl: async (_url, options) => {
    calls++;
    if (options.method === 'POST') throw new Error('simulated timeout');
    return response(calls === 1 ? [] : [database]);
  } });
  assert.equal(calls, 3);
});

test('D1 permission failures stop deployment with actionable non-sensitive error', async t => {
  const root = await fixture(t);
  await assert.rejects(preparePaymentsDeploy({ root, env, fetchImpl: async () => response(null, 403) }), /D1 > Edit/);
  await assert.rejects(readFile(join(root, '.wrangler/deploy.json')), { code: 'ENOENT' });
});
