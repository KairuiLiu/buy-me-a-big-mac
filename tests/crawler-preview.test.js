import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import cloudflare from '../worker/cloudflare.js';
import { createApp } from '../worker/index.js';
import { getBadgeLanguage } from '../src/lib/badges.js';
import { withLinkPreview } from '../src/lib/link-preview.js';

const ROOT = 'https://buy-me-a-big-mac.liukairui.me';
const PATHS = ['/gift/carousel', '/gift/carousel/', '/gift/carousel.html'];
const TELEGRAM = 'TelegramBot (like TwitterBot)';
const GIF = `${ROOT}${getBadgeLanguage('carousel').card}`;
const PNG = `${ROOT}${getBadgeLanguage('zh-CN').card}`;
const SHELL = withLinkPreview(
  '<!doctype html><head><!--link-preview--><!--/link-preview--></head><body><main>unchanged app</main><img src="/assets/badge-carousel.svg" /></body>',
  getBadgeLanguage('carousel'),
);
const image = (html, name) => html.match(new RegExp(`<meta (?:property|name)="${name}" content="([^"]+)"`))?.[1];
const request = (path, ua = TELEGRAM, method = 'GET', headers = {}) => new Request(`${ROOT}${path}`, {
  method, headers: { 'User-Agent': ua, ...headers },
});

function workerFixture({ status = 200, body = SHELL, headers = {}, conditional = false } = {}) {
  const calls = [];
  const env = { ASSETS: { async fetch(req) {
    calls.push(req);
    if (conditional && (req.headers.has('If-None-Match') || req.headers.has('If-Modified-Since'))) {
      return new Response(null, { status: 304 });
    }
    return new Response(req.method === 'HEAD' || status === 304 ? null : body, {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        ETag: '"gif-shell"',
        'Last-Modified': 'Wed, 14 Oct 2026 00:00:00 GMT',
        Vary: 'Accept-Encoding',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        ...headers,
      },
    });
  } } };
  return { calls, fetch: req => cloudflare.fetch(req, env) };
}

function localFixture() {
  return createApp({
    '/gift/carousel.html': { body: SHELL, type: 'text/html; charset=utf-8' },
    '/gift/en.html': { body: 'other share shell', type: 'text/html' },
    '/index.html': { body: 'default shell', type: 'text/html' },
    '/assets/badge-carousel.svg': { body: '<svg />', type: 'image/svg+xml' },
  });
}

function assertPrivateVariant(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.match(response.headers.get('Vary'), /(?:^|,\s*)User-Agent(?:,|$)/i);
  assert.equal(response.headers.get('ETag'), null);
  assert.equal(response.headers.get('Last-Modified'), null);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.ok(response.headers.get('Content-Security-Policy'));
}

for (const [name, fixture] of [['Cloudflare', workerFixture], ['local server', localFixture]]) {
  test(`${name}: Telegram gets PNG only on exact carousel paths while the app and button stay intact`, async () => {
    const app = fixture();
    for (const path of PATHS) {
      const response = await app.fetch(request(`${path}?p=owner%2Frepo&m=001&a=${'a'.repeat(32)}&h=1`));
      assertPrivateVariant(response);
      const html = await response.text();
      assert.equal(image(html, 'og:image'), PNG);
      assert.equal(image(html, 'twitter:image'), PNG);
      assert.equal(image(html, 'og:image:type'), 'image/png');
      assert.match(html, /<main>unchanged app<\/main>/);
      assert.match(html, /src="\/assets\/badge-carousel.svg"/);
      assert.ok(!html.includes(GIF));
    }
  });

  test(`${name}: Safari, iMessage and Twitter keep the animated preview`, async () => {
    const app = fixture();
    assert.ok(GIF.endsWith('.gif'));
    for (const ua of ['Mozilla/5.0 Version/18.0 Safari/605.1.15', 'iMessage Preview', 'Twitterbot/1.0', '']) {
      const response = await app.fetch(request('/gift/carousel', ua));
      assertPrivateVariant(response);
      const html = await response.text();
      assert.equal(image(html, 'og:image'), GIF);
      assert.equal(image(html, 'twitter:image'), GIF);
      assert.equal(image(html, 'og:image:type'), 'image/gif');
      assert.equal(html, SHELL);
    }
  });

  test(`${name}: HEAD serves empty bodies with the same isolated-cache policy`, async () => {
    const app = fixture();
    for (const path of PATHS) {
      for (const ua of [TELEGRAM, 'Safari']) {
        const response = await app.fetch(request(path, ua, 'HEAD'));
        assertPrivateVariant(response);
        assert.equal(await response.text(), '');
        assert.equal(response.headers.get('Content-Length'), null);
        assert.equal(response.headers.get('Content-Encoding'), null);
      }
    }
  });
}

test('Cloudflare strips conditional validators without changing the URL, query, account headers or original request', async () => {
  const app = workerFixture({ conditional: true });
  for (const ua of [TELEGRAM, 'Safari']) {
    for (const method of ['GET', 'HEAD']) {
      const req = request('/gift/carousel?p=owner%2Frepo&m=001&a=author&h=1', ua, method, {
        'If-None-Match': '"gif-shell"',
        'If-Modified-Since': 'Wed, 14 Oct 2026 00:00:00 GMT',
        Cookie: 'example=value',
      });
      const response = await app.fetch(req);
      assertPrivateVariant(response);
      const forwarded = app.calls.at(-1);
      assert.equal(forwarded.url, req.url);
      assert.equal(forwarded.method, method);
      assert.equal(forwarded.headers.get('User-Agent'), ua);
      assert.equal(forwarded.headers.get('Cookie'), 'example=value');
      assert.equal(forwarded.headers.get('If-None-Match'), null);
      assert.equal(forwarded.headers.get('If-Modified-Since'), null);
      assert.equal(req.headers.get('If-None-Match'), '"gif-shell"');
    }
  }
});

test('Cloudflare preserves Vary and security headers, removing stale representation metadata after rewriting', async () => {
  for (const vary of ['Accept-Encoding', 'Accept-Encoding, user-agent', '*']) {
    const app = workerFixture({ headers: { Vary: vary, 'Content-Length': '999', 'Content-Encoding': 'gzip' } });
    const response = await app.fetch(request('/gift/carousel', 'telegram/1.0'));
    assert.equal(image(await response.text(), 'og:image'), PNG);
    assert.equal(response.headers.get('Content-Length'), null);
    assert.equal(response.headers.get('Content-Encoding'), null);
    assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'self'");
    assert.equal(response.headers.get('Vary'), vary === 'Accept-Encoding' ? 'Accept-Encoding, User-Agent' : vary);
  }
});

test('Cloudflare leaves non-carousel paths, non-HTML assets, redirects, errors and unsupported methods untouched', async () => {
  for (const path of ['/gift', '/gift/en', '/preview/gift/carousel', '/gift/carousel/extra', '/gift/carouselx', '/assets/badge-carousel.svg']) {
    const app = workerFixture();
    const req = request(path, TELEGRAM, 'GET', { 'If-None-Match': '"other"' });
    const response = await app.fetch(req);
    assert.equal(app.calls[0], req);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600');
    assert.equal(response.headers.get('ETag'), '"gif-shell"');
    assert.equal(await response.text(), SHELL);
  }
  for (const setup of [
    { status: 302, body: '', headers: { Location: '/gift/carousel' } },
    { status: 404, body: 'missing' },
    { body: '<svg />', headers: { 'Content-Type': 'image/svg+xml' } },
  ]) {
    const app = workerFixture(setup);
    const response = await app.fetch(request('/gift/carousel'));
    assert.equal(response.status, setup.status ?? 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600');
    assert.equal(response.headers.get('ETag'), '"gif-shell"');
    assert.equal(await response.text(), setup.body);
    if (setup.status === 302) assert.equal(response.headers.get('Location'), '/gift/carousel');
  }
  const app = workerFixture({ status: 405, body: 'method not allowed' });
  const req = request('/gift/carousel', TELEGRAM, 'POST');
  const response = await app.fetch(req);
  assert.equal(app.calls[0], req);
  assert.equal(response.status, 405);
  assert.equal(await response.text(), 'method not allowed');
});

test('local routing and API dispatch stay unchanged outside carousel pages', async () => {
  const local = localFixture();
  for (const [path, body] of [['/', 'default shell'], ['/gift/en', 'other share shell'], ['/gift/unknown', 'default shell'], ['/assets/badge-carousel.svg', '<svg />']]) {
    const response = await local.fetch(request(path));
    assert.equal(await response.text(), body);
    assert.equal(response.headers.get('Vary'), null);
  }
  assert.equal((await local.fetch(request('/missing.svg'))).status, 404);
  const wrongMethod = await local.fetch(request('/gift/carousel', TELEGRAM, 'POST'));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('Allow'), 'GET, HEAD');
  for (const app of [local, workerFixture()]) {
    for (const path of ['/api/unknown', '/api/payments/unknown']) {
      const response = await app.fetch(request(path));
      assert.ok(response.status >= 400);
      assert.match(response.headers.get('Content-Type'), /^application\/json/);
    }
    if (app.calls) assert.equal(app.calls.length, 0);
  }
});

test('only the three carousel paths join APIs in Worker-first routing', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.assets.run_worker_first, ['/api/*', ...PATHS]);
});
