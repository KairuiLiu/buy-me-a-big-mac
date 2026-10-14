import { handleApi } from './api.js';
import { handlePayments, cleanupPayments } from './payments.js';
import { fetchWithCrawlerPreview } from './link-preview.js';

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/payments/')) return handlePayments(request, env);
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    // Only the carousel shell needs a crawler-specific image. Other pages
    // remain ordinary prerendered assets, served without this Worker.
    return fetchWithCrawlerPreview(request, assetRequest => env.ASSETS.fetch(assetRequest));
  },
  async scheduled(_event, env) {
    await cleanupPayments(env);
  },
};
