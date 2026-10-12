export const BADGE_LANGUAGES = [
  { value: 'en', label: 'English', text: 'Buy me a Big Mac', asset: '/assets/badge.svg', width: 224 },
  { value: 'zh-CN', label: '简体中文', text: '请我吃份巨无霸', asset: '/assets/badge-zh-cn.svg', width: 200 },
  { value: 'zh-TW', label: '繁體中文', text: '請我吃份大麥克', asset: '/assets/badge-zh-tw.svg', width: 200 },
  { value: 'yue-CN', label: '粤语（简体）', text: '请我食份巨无霸', asset: '/assets/badge-yue-cn.svg', width: 200 },
  { value: 'yue-HK', label: '粵語（繁體）', text: '請我食份巨無霸', asset: '/assets/badge-yue-hk.svg', width: 200 },
] as const;

export type BadgeLanguage = (typeof BADGE_LANGUAGES)[number]['value'];
export const DEFAULT_BADGE_LANGUAGE: BadgeLanguage = 'zh-CN';

export function getBadgeLanguage(value: string) {
  return BADGE_LANGUAGES.find(language => language.value === value)
    ?? BADGE_LANGUAGES.find(language => language.value === DEFAULT_BADGE_LANGUAGE)!;
}
