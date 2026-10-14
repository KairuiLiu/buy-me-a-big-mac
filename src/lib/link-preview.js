/**
 * Link preview tags are prerendered so crawlers do not need JavaScript.
 * Static badges use PNG cards; the carousel uses GIF so receiving platforms
 * can display its animation when supported. Embedded buttons still use SVG.
 */
import { escapeHTML } from './domain.js';

// Crawlers want absolute image URLs, and a prerendered file cannot learn the
// host it will be served from. Forks deploying elsewhere change this line.
const SITE_ORIGIN = 'https://buy-me-a-big-mac.liukairui.me';
const START = '<!--link-preview-->';
const END = '<!--/link-preview-->';
const SITE_NAME = 'Buy me a Big Mac';
const PROJECT = {
  text: 'Buy me a Big Mac · 给开源加个餐',
  description: '给喜欢的开源项目加个餐。通过麦当劳 MCP 选餐、计算建议金额，再用爱发电送上感谢。',
  alt: 'Buy me a Big Mac 的汉堡标志与项目名',
  card: '/assets/card-home.png',
};
// PNG and GIF preview cards share the same canvas size.
const CARD = { width: '1200', height: '630', type: 'image/png' };

function tag(attribute, name, content) {
  return `<meta ${attribute}="${name}" content="${escapeHTML(content)}" />`;
}

/**
 * @param {import('./badges.js').Badge} [badge] The sponsorship button this page
 *   shares. Without one the preview describes the project itself.
 */
export function linkPreviewTags(badge) {
  const preview = badge ?? PROJECT;
  const card = new URL(preview.card, SITE_ORIGIN).href;
  const image = { ...CARD, type: preview.card.endsWith('.gif') ? 'image/gif' : CARD.type };
  return [
    tag('property', 'og:type', 'website'),
    tag('property', 'og:site_name', SITE_NAME),
    tag('property', 'og:title', preview.text),
    tag('property', 'og:description', preview.description),
    tag('property', 'og:image', card),
    tag('property', 'og:image:type', image.type),
    tag('property', 'og:image:width', image.width),
    tag('property', 'og:image:height', image.height),
    tag('property', 'og:image:alt', preview.alt),
    tag('name', 'twitter:card', 'summary_large_image'),
    tag('name', 'twitter:title', preview.text),
    tag('name', 'twitter:description', preview.description),
    tag('name', 'twitter:image', card),
    tag('name', 'twitter:image:alt', preview.alt),
  ].join('\n  ');
}

/**
 * Replace the marked block in a document. Pages without the markers, including
 * anything that is not our own shell, are returned untouched.
 * @param {string} html
 * @param {import('./badges.js').Badge} [badge]
 */
export function withLinkPreview(html, badge) {
  const start = html.indexOf(START);
  const end = start < 0 ? -1 : html.indexOf(END, start + START.length);
  if (end < 0) return html;
  return `${html.slice(0, start + START.length)}\n  ${linkPreviewTags(badge)}\n  ${html.slice(end)}`;
}
