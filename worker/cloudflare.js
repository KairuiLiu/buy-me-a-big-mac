import { handleApi } from './api.js';
import { handlePayments, cleanupPayments } from './payments.js';
import { fetchWithCrawlerPreview } from './link-preview.js';
import { fetchPreviewMedia, PREVIEW_VIDEO_PATH } from './media.js';

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/payments/')) return handlePayments(request, env);
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    if (pathname === PREVIEW_VIDEO_PATH) return fetchPreviewMedia(request, assetRequest => env.ASSETS.fetch(assetRequest));
    // Only the carousel shell needs crawler-specific metadata. Other pages
    // remain ordinary prerendered assets, served without this Worker.
    return fetchWithCrawlerPreview(request, assetRequest => env.ASSETS.fetch(assetRequest));
  },
  async scheduled(_event, env) {
    await cleanupPayments(env);
  },
};
