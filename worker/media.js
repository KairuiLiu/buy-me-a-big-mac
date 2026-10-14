import { getBadgeLanguage } from '../src/lib/badges.js';

export const PREVIEW_VIDEO_PATH = getBadgeLanguage('carousel').video;
const MAX_VIDEO_BYTES = 1024 * 1024;

// Buffer only this small, fixed preview. Oversized responses retain their
// original stream instead of turning this into a general media proxy.
async function boundedBody(response) {
  const declared = Number(response.headers.get('Content-Length'));
  if (declared > MAX_VIDEO_BYTES) return null;
  const copy = response.clone();
  if (!copy.body) return new Uint8Array();
  const reader = copy.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_VIDEO_BYTES) {
        // A tee's cancellation waits for the other branch, which is returned
        // unchanged to the caller in this case.
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  void response.body?.cancel().catch(() => {});
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function matchesIfRange(value, headers) {
  if (value === null) return true;
  if (value.startsWith('"')) return value === headers.get('ETag');
  if (value.startsWith('W/')) return false;
  const date = Date.parse(value);
  const modified = Date.parse(headers.get('Last-Modified') ?? '');
  return Number.isFinite(date) && date === modified;
}

function passThrough(response, method) {
  if (method !== 'HEAD') return response;
  void response.body?.cancel().catch(() => {});
  return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function byteRange(value, length) {
  const match = value.length <= 128 && /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || !length) return null;
  const size = BigInt(length);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    return suffix > 0n ? [Number(suffix >= size ? 0n : size - suffix), length - 1] : null;
  }
  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : size - 1n;
  if (start >= size || end < start) return null;
  return [Number(start), Number(end >= size ? size - 1n : end)];
}

/**
 * Apple link previews probe the MP4 with bytes=0-1 before downloading it.
 * The asset service may ignore Range, so supply single byte ranges here.
 * @param {Request} request
 * @param {(request: Request) => Promise<Response>} fetchAsset
 */
export async function fetchPreviewMedia(request, fetchAsset) {
  if (new URL(request.url).pathname !== PREVIEW_VIDEO_PATH || !['GET', 'HEAD'].includes(request.method)) {
    return fetchAsset(request);
  }
  const sourceHeaders = new Headers(request.headers);
  for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) sourceHeaders.delete(name);
  const response = await fetchAsset(new Request(request, { method: 'GET', headers: sourceHeaders }));
  const encoding = response.headers.get('Content-Encoding');
  if (response.status !== 200 || !/^video\/mp4(?:\s*;|\s*$)/i.test(response.headers.get('Content-Type') ?? '')
      || (encoding && encoding.toLowerCase() !== 'identity')) {
    return passThrough(response, request.method);
  }
  const bytes = await boundedBody(response);
  if (!bytes) return passThrough(response, request.method);

  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'video/mp4');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(bytes.byteLength));
  headers.delete('Content-Range');
  // The full asset bytes are available to slice, rather than an encoded body.
  headers.delete('Content-Encoding');
  const range = request.method === 'GET' ? request.headers.get('Range') : null;
  if (range !== null && matchesIfRange(request.headers.get('If-Range'), headers)) {
    const bounds = byteRange(range, bytes.byteLength);
    if (!bounds) {
      headers.set('Content-Range', `bytes */${bytes.byteLength}`);
      headers.set('Content-Length', '0');
      return new Response(null, { status: 416, headers });
    }
    const [start, end] = bounds;
    headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(bytes.slice(start, end + 1), { status: 206, headers });
  }
  return new Response(request.method === 'HEAD' ? null : bytes, { status: 200, headers });
}
