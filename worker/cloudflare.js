import { handleApi } from './api.js';
import { handlePayments, cleanupPayments } from './payments.js';

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/api/payments/')) return handlePayments(request, env);
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env) {
    await cleanupPayments(env);
  },
};
