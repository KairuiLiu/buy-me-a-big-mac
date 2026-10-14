import { getBadgeLanguage } from '../src/lib/badges.js';
import { withLinkPreview } from '../src/lib/link-preview.js';

const CAROUSEL_PATHS = new Set(['/gift/carousel', '/gift/carousel/', '/gift/carousel.html']);

/**
 * Every client gets the same PNG poster. Telegram omits the supplementary
 * video, while capable clients can animate the MP4 in the static shell.
 * Both representations bypass conditional/cache reuse, so a video-enabled
 * response cannot turn a later Telegram fetch into a bodyless 304.
 * @param {Request} request
 * @param {(request: Request) => Promise<Response>} fetchAsset
 */
export async function fetchWithCrawlerPreview(request, fetchAsset) {
  if (!['GET', 'HEAD'].includes(request.method)
      || !CAROUSEL_PATHS.has(new URL(request.url).pathname)) {
    return fetchAsset(request);
  }

  const assetHeaders = new Headers(request.headers);
  assetHeaders.delete('If-None-Match');
  assetHeaders.delete('If-Modified-Since');
  const response = await fetchAsset(new Request(request, { headers: assetHeaders }));
  if (response.status !== 200 || !/^text\/html(?:\s*;|\s*$)/i.test(response.headers.get('Content-Type') ?? '')) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  const vary = (headers.get('Vary') ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!vary.some(value => value === '*' || value.toLowerCase() === 'user-agent')) vary.push('User-Agent');
  headers.set('Vary', vary.join(', '));
  headers.delete('ETag');
  headers.delete('Last-Modified');

  let body = response.body;
  if (request.method === 'HEAD') {
    body = null;
    // A rewritten GET may have a different length or transfer encoding.
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
  } else if (/Telegram(?:Bot)?/i.test(request.headers.get('User-Agent') ?? '')) {
    body = withLinkPreview(await response.text(), { ...getBadgeLanguage('carousel'), video: undefined });
    headers.delete('Content-Length');
    headers.delete('Content-Encoding');
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
