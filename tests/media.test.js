import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPreviewMedia, PREVIEW_VIDEO_PATH } from '../worker/media.js';
import cloudflare from '../worker/cloudflare.js';
import { createApp } from '../worker/index.js';

const ORIGIN = 'https://example.test';
const DATA = Uint8Array.from({ length: 10 }, (_, index) => index);
const MODIFIED = 'Wed, 14 Oct 2026 00:00:00 GMT';
const req = (range, headers = {}, method = 'GET', path = PREVIEW_VIDEO_PATH) => new Request(`${ORIGIN}${path}`, {
  method, headers: { ...(range === undefined ? {} : { Range: range }), ...headers },
});
function fixture({ body = DATA, status = 200, headers = {} } = {}) {
  const requests = [];
  const fetch = async request => {
    requests.push(request);
    return new Response(body, { status, headers: {
      'Content-Type': 'video/mp4', ETag: '"preview-v3"', 'Last-Modified': MODIFIED,
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'", ...headers,
    } });
  };
  return { requests, fetch };
}
const bytes = async response => new Uint8Array(await response.arrayBuffer());

test('preview media returns actual full length and preserves cache, CORS and security headers', async () => {
  const source = fixture({ headers: { 'Content-Length': '999' } });
  const response = await fetchPreviewMedia(req(), source.fetch);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.equal(response.headers.get('Content-Length'), '10');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(response.headers.get('Content-Range'), null);
  for (const [name, value] of [['ETag', '"preview-v3"'], ['Last-Modified', MODIFIED],
    ['Cache-Control', 'public, max-age=0, must-revalidate'], ['Access-Control-Allow-Origin', '*'],
    ['X-Content-Type-Options', 'nosniff'], ['Content-Security-Policy', "default-src 'self'"]]) {
    assert.equal(response.headers.get(name), value);
  }
  assert.deepEqual(await bytes(response), DATA);
});

test('single bounded, open-ended and suffix ranges return exact byte slices', async () => {
  for (const [range, start, end] of [
    ['bytes=0-1', 0, 1], ['bytes=2-5', 2, 5], ['bytes=8-', 8, 9],
    ['bytes=-3', 7, 9], ['bytes=-100', 0, 9], ['bytes=1-99999999999999999999999', 1, 9],
    ['bytes=0-9', 0, 9],
  ]) {
    const response = await fetchPreviewMedia(req(range), fixture().fetch);
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/10`);
    assert.equal(response.headers.get('Content-Length'), String(end - start + 1));
    assert.deepEqual(await bytes(response), DATA.slice(start, end + 1));
  }
});

test('invalid, unsupported multipart and unsatisfiable ranges return empty 416', async () => {
  for (const range of ['', 'bytes=10-', 'bytes=9-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4',
    'items=0-1', 'bytes=no-3', 'bytes=99999999999999999999-', 'bytes=1.5-3']) {
    const response = await fetchPreviewMedia(req(range), fixture().fetch);
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('Content-Range'), 'bytes */10');
    assert.equal(response.headers.get('Content-Length'), '0');
    assert.equal((await bytes(response)).length, 0);
  }
  const empty = await fetchPreviewMedia(req('bytes=0-1'), fixture({ body: new Uint8Array() }).fetch);
  assert.equal(empty.status, 416);
  assert.equal(empty.headers.get('Content-Range'), 'bytes */0');
});

test('If-Range accepts matching strong validators and otherwise returns the complete file', async () => {
  for (const value of ['"preview-v3"', MODIFIED]) {
    assert.equal((await fetchPreviewMedia(req('bytes=0-1', { 'If-Range': value }), fixture().fetch)).status, 206);
  }
  for (const value of ['', '"old"', 'W/"preview-v3"', 'invalid', 'Tue, 13 Oct 2026 00:00:00 GMT']) {
    const response = await fetchPreviewMedia(req('bytes=0-1', { 'If-Range': value }), fixture().fetch);
    assert.equal(response.status, 200, value);
    assert.equal(response.headers.get('Content-Range'), null);
    assert.deepEqual(await bytes(response), DATA);
  }
});

test('HEAD ignores Range and returns the full length without a body', async () => {
  const source = fixture();
  const response = await fetchPreviewMedia(req('bytes=0-1', {}, 'HEAD'), source.fetch);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), '10');
  assert.equal(response.headers.get('Content-Range'), null);
  assert.equal((await bytes(response)).length, 0);
  assert.equal(source.requests[0].method, 'GET');
});

test('full-source fetch strips range and conditional headers without mutating the original request', async () => {
  const source = fixture();
  const request = req('bytes=0-1', {
    'If-Range': '"preview-v3"', 'If-None-Match': '"preview-v3"', 'If-Modified-Since': MODIFIED,
    'User-Agent': 'Apple LinkPresentation', Cookie: 'example=value',
  }, 'GET', `${PREVIEW_VIDEO_PATH}?test=1`);
  await fetchPreviewMedia(request, source.fetch);
  assert.equal(source.requests[0].url, request.url);
  for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
    assert.equal(source.requests[0].headers.get(name), null);
    assert.ok(request.headers.has(name));
  }
  assert.equal(source.requests[0].headers.get('User-Agent'), 'Apple LinkPresentation');
  assert.equal(source.requests[0].headers.get('Cookie'), 'example=value');
});

test('non-targets, methods, non-video, encoded and non-200 responses are not transformed', async () => {
  for (const request of [req('bytes=0-1', {}, 'GET', '/assets/other.mp4'), req(undefined, {}, 'POST')]) {
    const source = fixture();
    const response = await fetchPreviewMedia(request, source.fetch);
    assert.equal(source.requests[0], request);
    assert.equal(response.headers.get('Accept-Ranges'), null);
  }
  for (const setup of [{ status: 404, body: 'missing' }, { status: 302, body: '', headers: { Location: '/other' } },
    { headers: { 'Content-Type': 'text/html' } }, { headers: { 'Content-Encoding': 'gzip' } }]) {
    const response = await fetchPreviewMedia(req('bytes=0-1'), fixture(setup).fetch);
    assert.equal(response.status, setup.status ?? 200);
    assert.equal(response.headers.get('Accept-Ranges'), null);
    if (setup.body !== undefined) assert.equal(await response.text(), setup.body);
    const head = await fetchPreviewMedia(req('bytes=0-1', {}, 'HEAD'), fixture(setup).fetch);
    assert.equal(head.status, setup.status ?? 200);
    assert.equal((await bytes(head)).length, 0);
  }
});

test('files over the 1 MiB bound retain the original response without range processing', async () => {
  const big = new Uint8Array(1024 * 1024 + 1);
  for (const headers of [{}, { 'Content-Length': String(big.length) }]) {
    const response = await fetchPreviewMedia(req('bytes=0-1'), fixture({ body: big, headers }).fetch);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Accept-Ranges'), null);
    assert.deepEqual(await bytes(response), big);
    const head = await fetchPreviewMedia(req('bytes=0-1', {}, 'HEAD'), fixture({ body: big, headers }).fetch);
    assert.equal(head.status, 200);
    assert.equal((await bytes(head)).length, 0);
  }
});

test('Cloudflare and local application routing serve the same MP4 range contract', async () => {
  const source = fixture();
  const apps = [
    { fetch: request => cloudflare.fetch(request, { ASSETS: { fetch: source.fetch } }) },
    createApp({ [PREVIEW_VIDEO_PATH]: { body: DATA, type: 'video/mp4' } }),
  ];
  for (const app of apps) {
    const response = await app.fetch(req('bytes=0-1'));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-1/10');
    assert.deepEqual(await bytes(response), DATA.slice(0, 2));
    const head = await app.fetch(req('bytes=0-1', {}, 'HEAD'));
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('Content-Length'), '10');
    assert.equal((await bytes(head)).length, 0);
  }
});
