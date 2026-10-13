/**
 * Page routes. The build and the server need this table too: each share
 * language has its own prerendered shell, so a crawler that never runs our
 * JavaScript still gets the right link preview from a plain static file.
 */
import { BADGE_LANGUAGES, DEFAULT_BADGE_LANGUAGE, getBadgeLanguage } from './badges.js';

/**
 * @typedef {object} Route
 * @property {'create' | 'gift' | 'thanks' | 'unknown'} page
 * @property {boolean} preview local design preview, never a real order
 * @property {boolean} [demo] carries its own sample data instead of a link
 * @property {string} [receiptId]
 */

/** @type {Record<string, Route>} */
const PAGES = {
  '/': { page: 'create', preview: false },
  '/gift': { page: 'gift', preview: false },
  '/preview': { page: 'gift', preview: true, demo: true },
  '/preview/create': { page: 'create', preview: true },
  '/preview/gift': { page: 'gift', preview: true },
  '/preview/thanks': { page: 'thanks', preview: true, demo: true },
};
const SLUGS = new Set(BADGE_LANGUAGES.map(badge => badge.slug));

/**
 * @param {string} pathname
 * @returns {Route}
 */
export function matchRoute(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (Object.hasOwn(PAGES, path)) return PAGES[path];
  const gift = /^(\/preview)?\/gift\/([^/]+)$/.exec(path);
  if (gift && SLUGS.has(gift[2])) return { page: 'gift', preview: Boolean(gift[1]) };
  const receipt = /^\/thanks\/([0-9a-f]{32})$/.exec(path);
  if (receipt) return { page: 'thanks', preview: false, receiptId: receipt[1] };
  return { page: 'unknown', preview: path.startsWith('/preview/') };
}

/**
 * The default language needs no segment: `/gift` already previews its badge.
 * @param {boolean} [preview]
 * @param {string} [language]
 */
export function giftPath(preview, language = DEFAULT_BADGE_LANGUAGE) {
  const badge = getBadgeLanguage(language);
  const segment = badge.value === DEFAULT_BADGE_LANGUAGE ? '' : `/${badge.slug}`;
  return `${preview ? '/preview' : ''}/gift${segment}`;
}

/** @param {boolean} [preview] */
export const createPath = preview => (preview ? '/preview/create' : '/');

/** @param {string} intentId */
export const thanksPath = intentId => `/thanks/${intentId}`;
