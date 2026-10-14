import { handleApi } from './api.js';
import { handlePayments } from './payments.js';
import { fetchWithCrawlerPreview } from './link-preview.js';

const SECURITY_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action https://afdian.com",
};

export function createApp(assets) {
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/payments/')) return handlePayments(request, env);
      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      if (!['GET', 'HEAD'].includes(request.method)) {
        return new Response('Method not allowed', { status: 405, headers: { ...SECURITY_HEADERS, Allow: 'GET, HEAD' } });
      }
      return fetchWithCrawlerPreview(request, async assetRequest => {
        // Mirror Cloudflare's asset handling: a page may have its own prerendered
        // shell, and anything else that looks like a page falls back to the
        // default shell, which then shows the real page or a bad-link notice.
        const pathname = url.pathname === '/gift/carousel/' ? '/gift/carousel' : url.pathname;
        const pick = name => (Object.hasOwn(assets, name) ? assets[name] : null);
        const asset = pick(pathname === '/' ? '/index.html' : pathname)
          ?? pick(`${pathname}.html`)
          ?? (/\.[^/]+$/.test(pathname) ? null : pick('/index.html'));
        if (!asset) return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
        return new Response(assetRequest.method === 'HEAD' ? null : asset.body, {
          headers: { ...SECURITY_HEADERS, 'Content-Type': asset.type, 'Cache-Control': 'no-store' },
        });
      });
    },
  };
}
