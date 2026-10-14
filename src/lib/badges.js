/**
 * Badge options shared by the author page, the README markup, the share paths
 * and the link preview cards.
 */

/** @typedef {'en' | 'zh-CN' | 'zh-TW' | 'yue-CN' | 'yue-HK' | 'carousel'} BadgeLanguage */

/**
 * @typedef {object} Badge
 * @property {BadgeLanguage} value
 * @property {string} slug lowercase form used by asset names and share paths
 * @property {string} label
 * @property {string} text badge wording, also the link preview title
 * @property {string} description link preview subtitle
 * @property {string} alt link preview image description
 * @property {string} asset badge SVG for the page and README
 * @property {string} card PNG fallback for link previews
 * @property {string} [video] optional downloadable MP4 preview
 * @property {number} width
 * @property {number} [height] defaults to 52 for static badges
 */

/** @type {readonly Badge[]} */
export const BADGE_LANGUAGES = [
  { value: 'en', slug: 'en', label: 'English', text: 'Buy me a Big Mac', description: 'Pick a meal for the author and send it through Afdian.', alt: 'The Buy me a Big Mac sponsorship button', asset: '/assets/badge.svg', card: '/assets/card-en.png', width: 224 },
  { value: 'zh-CN', slug: 'zh-cn', label: '简体中文', text: '请我吃份巨无霸', description: '挑一份餐，在爱发电把这顿麦当劳送给作者。', alt: '“请我吃份巨无霸”赞助按钮', asset: '/assets/badge-zh-cn.svg', card: '/assets/card-zh-cn.png', width: 200 },
  { value: 'zh-TW', slug: 'zh-tw', label: '繁體中文', text: '請我吃份大麥克', description: '挑一份餐，在愛發電把這頓麥當勞送給作者。', alt: '「請我吃份大麥克」贊助按鈕', asset: '/assets/badge-zh-tw.svg', card: '/assets/card-zh-tw.png', width: 200 },
  { value: 'yue-CN', slug: 'yue-cn', label: '粤语（简体）', text: '请我食份巨无霸', description: '拣一份餐，在爱发电请作者食餐麦当劳。', alt: '“请我食份巨无霸”赞助按钮', asset: '/assets/badge-yue-cn.svg', card: '/assets/card-yue-cn.png', width: 200 },
  { value: 'yue-HK', slug: 'yue-hk', label: '粵語（繁體）', text: '請我食份巨無霸', description: '揀一份餐，在愛發電請作者食餐麥當勞。', alt: '「請我食份巨無霸」贊助按鈕', asset: '/assets/badge-yue-hk.svg', card: '/assets/card-yue-hk.png', width: 200 },
  { value: 'carousel', slug: 'carousel', label: '炫酷轮播', text: '请我吃份巨无霸', description: '挑一份餐，在爱发电把这顿麦当劳送给作者。', alt: '“请我吃份巨无霸”赞助按钮', asset: '/assets/badge-carousel.svg', card: '/assets/card-carousel-poster-v3.png', video: '/assets/card-carousel-v3.mp4', width: 233, height: 53 },
];

// A new query value gives messengers a fresh page URL after preview changes.
export const CAROUSEL_PREVIEW_REVISION = '3';

const DEFAULT_INDEX = 1;
export const DEFAULT_BADGE_LANGUAGE = BADGE_LANGUAGES[DEFAULT_INDEX].value;

/** @param {string} value */
export function getBadgeLanguage(value) {
  return BADGE_LANGUAGES.find(language => language.value === value) ?? BADGE_LANGUAGES[DEFAULT_INDEX];
}
