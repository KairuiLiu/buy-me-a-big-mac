import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reuse the database by its configured name on every deployment. API responses
// and credentials are never logged; an interrupted create is recovered by lookup.
export async function preparePaymentsDeploy({ env = process.env, fetchImpl = fetch, root = ROOT } = {}) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!/^[0-9a-f]{32}$/i.test(account || '') || !token) throw new Error('Cloudflare deployment credentials are missing.');
  const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
  const binding = config.d1_databases?.find(item => item.binding === 'PAYMENTS_DB');
  if (!binding?.database_name) throw new Error('PAYMENTS_DB configuration is missing.');
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;

  async function api(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    } catch { throw new Error('Cloudflare D1 request failed; retry this deployment to recover by database name.'); }
    if ([401, 403].includes(response.status)) throw new Error('Cloudflare token needs Account > D1 > Edit permission (D1 Write) on this account. Update CLOUDFLARE_API_TOKEN and rerun deployment.');
    let payload;
    try { payload = await response.json(); } catch { /* Report only a fixed message. */ }
    if (!response.ok || payload?.success !== true) throw new Error(`Cloudflare D1 operation failed (HTTP ${response.status}); retry deployment.`);
    return payload;
  }

  async function lookup() {
    const matches = [];
    for (let page = 1; ; page++) {
      const url = new URL(base);
      url.searchParams.set('name', binding.database_name);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const payload = await api(url);
      if (!Array.isArray(payload.result)) throw new Error('Invalid Cloudflare D1 lookup response.');
      matches.push(...payload.result.filter(db => db.name === binding.database_name));
      if (payload.result.length < 100 || page >= (payload.result_info?.total_pages || 100)) break;
      if (page >= 100) throw new Error('Cloudflare D1 lookup exceeded the pagination limit.');
    }
    if (matches.length > 1) throw new Error('Multiple payment databases match the configured name; deployment stopped.');
    return matches[0];
  }

  let database = await lookup();
  if (!database) {
    try {
      database = (await api(base, { method: 'POST', body: JSON.stringify({
        name: binding.database_name, primary_location_hint: 'apac', read_replication: { mode: 'disabled' },
      }) })).result;
    } catch (error) {
      database = await lookup();
      if (!database) throw error;
    }
  }
  if (!UUID.test(database?.uuid || '')) throw new Error('Cloudflare returned an invalid D1 database identifier.');
  binding.database_id = database.uuid;
  binding.migrations_dir = resolve(root, binding.migrations_dir || 'migrations');
  config.main = resolve(root, config.main);
  config.assets.directory = resolve(root, config.assets.directory);
  const destination = resolve(root, '.wrangler/deploy.json');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return { databaseId: database.uuid, configPath: destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { databaseId } = await preparePaymentsDeploy();
    console.log(`Payment D1 ready: ${databaseId}. Deployment configuration: .wrangler/deploy.json`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
