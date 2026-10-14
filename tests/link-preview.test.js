import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readAssets } from '../scripts/assets.mjs';
import { createApp } from '../worker/index.js';
import { BADGE_LANGUAGES, DEFAULT_BADGE_LANGUAGE, getBadgeLanguage } from '../src/lib/badges.js';
import { createShareUrl, decodeConfig, normalizeConfig } from '../src/lib/domain.js';
import { linkPreviewTags, withLinkPreview } from '../src/lib/link-preview.js';
import { createPath, giftPath, matchRoute, thanksPath } from '../src/lib/routes.js';

const config = { v: 1, repo: 'octocat/hello-world', storeCode: '100001', beType: 1, afdianId: 'a'.repeat(32), orderType: 1 };
const shell = '<head>\n  <title>t</title>\n  <!--link-preview--><!--/link-preview-->\n</head>';
const content = (html, attribute, name) =>
  html.match(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)" />`))?.[1] ?? null;

test('the default shell previews the project, not a sponsorship badge', () => {
  const html = withLinkPreview(shell);
  assert.equal(content(html, 'property', 'og:image'), 'https://buy-me-a-big-mac.liukairui.me/assets/card-home.png');
  assert.equal(content(html, 'property', 'og:title'), 'Buy me a Big Mac');
  assert.equal(content(html, 'name', 'twitter:card'), 'summary_large_image');
  assert.equal(content(html, 'property', 'og:image:width'), '1200');
});

test('every badge has a PNG poster and only the carousel offers a downloadable video', () => {
  for (const badge of BADGE_LANGUAGES) {
    const html = withLinkPreview(shell, badge);
    const card = `https://buy-me-a-big-mac.liukairui.me${badge.card}`;
    assert.equal(content(html, 'property', 'og:image'), card);
    assert.equal(content(html, 'name', 'twitter:image'), card);
    assert.equal(content(html, 'property', 'og:image:type'), 'image/png');
    assert.equal(content(html, 'property', 'og:image:width'), '1200');
    assert.equal(content(html, 'property', 'og:image:height'), '630');
    assert.equal(content(html, 'property', 'og:title'), badge.text);
    assert.equal(content(html, 'property', 'og:description'), badge.description);
    assert.equal(content(html, 'property', 'og:image:alt'), badge.alt);
    assert.equal(content(html, 'property', 'og:video'), badge.video ? `https://buy-me-a-big-mac.liukairui.me${badge.video}` : null);
    if (badge.video) {
      assert.equal(content(html, 'property', 'og:video:type'), 'video/mp4');
      assert.equal(content(html, 'property', 'og:video:width'), '1200');
      assert.equal(content(html, 'property', 'og:video:height'), '630');
    }
  }
  const carousel = getBadgeLanguage('carousel');
  assert.equal(carousel.value, 'carousel');
  assert.equal(content(withLinkPreview(shell, carousel), 'property', 'og:image'),
    'https://buy-me-a-big-mac.liukairui.me/assets/card-carousel-poster-v3.png');
});

test('preview tags never break out of their attributes', () => {
  for (const tags of [linkPreviewTags(), linkPreviewTags(getBadgeLanguage('yue-HK'))]) {
    for (const line of tags.split('\n')) {
      assert.match(line.trim(), /^<meta (?:property|name)="[\w:]+" content="[^"<>]*" \/>$/);
    }
  }
});

test('documents without the preview markers are passed through untouched', () => {
  for (const html of ['<head></head>', '<!--link-preview--><head></head>', '']) {
    assert.equal(withLinkPreview(html, BADGE_LANGUAGES[0]), html);
  }
});

test('share links resolve to a gift route whose shell matches the chosen badge', () => {
  for (const badge of BADGE_LANGUAGES) {
    for (const preview of [false, true]) {
      const url = new URL(createShareUrl('https://example.com/', config, { preview, language: badge.value }));
      const route = matchRoute(url.pathname);
      assert.equal(route.page, 'gift');
      assert.equal(route.preview, preview);
      assert.equal(url.pathname, giftPath(preview, badge.value));
      assert.deepEqual(decodeConfig(url.search.slice(1)), normalizeConfig(config));
      // The badge language travels as a path segment, so a static shell can
      // answer it; the default language needs no segment at all.
      assert.equal(url.pathname.endsWith(`/${badge.slug}`), badge.value !== DEFAULT_BADGE_LANGUAGE);
    }
  }
  assert.equal(giftPath(false, 'nonexistent'), '/gift');
  assert.deepEqual(matchRoute('/gift/klingon'), { page: 'unknown', preview: false });
});

test('page routes and their paths stay in step', () => {
  for (const [path, page, preview] of [
    [createPath(false), 'create', false],
    [createPath(true), 'create', true],
    [giftPath(false), 'gift', false],
    [giftPath(true), 'gift', true],
    [thanksPath('a'.repeat(32)), 'thanks', false],
    ['/preview', 'gift', true],
    ['/preview/thanks', 'thanks', true],
  ]) {
    assert.deepEqual([matchRoute(path).page, matchRoute(path).preview], [page, preview], path);
  }
  assert.equal(matchRoute(thanksPath('a'.repeat(32))).receiptId, 'a'.repeat(32));
  for (const path of ['/thanks/short', '/create', '/assets/card-home.png', '/__proto__', '/gift/en/extra']) {
    assert.equal(matchRoute(path).page, 'unknown', path);
  }
});

test('the local server serves a prerendered shell per page route and real files untouched', async () => {
  const shells = Object.fromEntries(BADGE_LANGUAGES.map(badge =>
    [`${giftPath(false, badge.value)}.html`, { body: `<html>${badge.card}</html>`, type: 'text/html; charset=utf-8' }]));
  const card = await readFile(new URL('../public/assets/card-zh-cn.png', import.meta.url));
  const app = createApp({
    ...shells,
    '/index.html': { body: '<html>default</html>', type: 'text/html; charset=utf-8' },
    '/assets/card-zh-cn.png': { body: card, type: 'image/png' },
  });
  const body = async path => (await app.fetch(new Request(`https://example.com${path}`))).text();
  assert.equal(await body('/gift'), '<html>/assets/card-zh-cn.png</html>');
  assert.equal(await body('/gift/en'), '<html>/assets/card-en.png</html>');
  assert.equal(await body('/gift/carousel'), '<html>/assets/card-carousel-poster-v3.png</html>');
  assert.equal(await body(`/gift?p=${config.repo}`), '<html>/assets/card-zh-cn.png</html>');
  // Client-side routes, and bad links the page itself explains, share the
  // default shell; missing files stay missing.
  for (const path of ['/', `/thanks/${'b'.repeat(32)}`, '/preview', '/preview/gift', '/gift/klingon']) {
    assert.equal(await body(path), '<html>default</html>', path);
  }
  for (const path of ['/worker/index.js', '/index.htm', '/assets/card-en.png']) {
    assert.equal((await app.fetch(new Request(`https://example.com${path}`))).status, 404, path);
  }
  const png = await app.fetch(new Request('https://example.com/assets/card-zh-cn.png'));
  assert.equal(png.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(Buffer.from(await png.arrayBuffer()), card);
});

test('every preview card ships with the right dimensions and is loaded without binary corruption', async () => {
  const assets = await readAssets(fileURLToPath(new URL('../public', import.meta.url)));
  for (const badge of BADGE_LANGUAGES) {
    const image = await readFile(new URL(`../public${badge.card}`, import.meta.url));
    assert.deepEqual(assets[badge.card].body, image);
    assert.equal(assets[badge.card].type, 'image/png');
    assert.deepEqual(image.subarray(1, 4), Buffer.from('PNG'));
    assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [1200, 630]);
  }
  const { video } = getBadgeLanguage('carousel');
  const bytes = await readFile(new URL(`../public${video}`, import.meta.url));
  assert.deepEqual(assets[video].body, bytes);
  assert.equal(assets[video].type, 'video/mp4');
  assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
  // Fast-start metadata must precede media so clients can play without a full download.
  const atoms = [];
  for (let offset = 0; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    assert.ok(size >= 8 && offset + size <= bytes.length);
    atoms.push(bytes.subarray(offset + 4, offset + 8).toString());
    offset += size;
  }
  assert.ok(atoms.indexOf('moov') >= 0 && atoms.indexOf('moov') < atoms.indexOf('mdat'));
  assert.ok(bytes.length < 1_000_000);
});
