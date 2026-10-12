import { handleApi } from './api.js';
import { handlePayments } from './payments.js';

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
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      const asset = Object.hasOwn(assets, path) ? assets[path] : null;
      if (!asset) return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
      return new Response(request.method === 'HEAD' ? null : asset.body, {
        headers: { ...SECURITY_HEADERS, 'Content-Type': asset.type, 'Cache-Control': 'no-store' },
      });
    },
  };
}
