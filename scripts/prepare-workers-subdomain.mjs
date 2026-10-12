import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Cloudflare requires an account subdomain for Cron, even for custom-domain-only
// Workers. Never replace an existing account subdomain or enable workers_dev.
export async function ensureWorkersSubdomain({ env = process.env, fetchImpl = fetch, name = 'buy-me-a-big-mac' } = {}) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!/^[0-9a-f]{32}$/i.test(account || '') || !token) throw new Error('Cloudflare deployment credentials are missing.');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,44}[a-z0-9])?$/.test(name)) throw new Error('Invalid Workers subdomain prefix.');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`;

  async function request(options = {}) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
    } catch { throw new Error('Cloudflare Workers subdomain request failed; rerun deployment.'); }
    let payload;
    try { payload = await response.json(); } catch { /* Never expose raw responses. */ }
    if (response.ok && payload?.success === true && typeof payload.result?.subdomain === 'string' && payload.result.subdomain) return payload.result.subdomain;
    if ([401, 403].includes(response.status)) throw new Error('Cloudflare token needs Workers Scripts permissions to configure the account subdomain required by Cron.');
    // Wrangler uses this specific error to distinguish a genuinely missing
    // account subdomain from authentication, network, and service errors.
    if (!options.method && response.status >= 400 && response.status < 500 && payload?.errors?.some(error => error.code === 10007)) return null;
    throw new Error(`Cloudflare Workers subdomain operation failed (HTTP ${response.status}); rerun deployment.`);
  }

  const existing = await request();
  if (existing) return existing;
  try {
    return await request({ method: 'PUT', body: JSON.stringify({ subdomain: `${name}-${account.slice(0, 8).toLowerCase()}` }) });
  } catch (error) {
    // The create may have succeeded before its response was lost.
    const recovered = await request();
    if (recovered) return recovered;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const subdomain = await ensureWorkersSubdomain();
    console.log(`Account Cron prerequisite ready: ${subdomain}.workers.dev; public workers.dev route remains disabled.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
