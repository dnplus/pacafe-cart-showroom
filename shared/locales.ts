export const locales = ['zh-TW', 'zh-CN', 'ja', 'ko', 'en'] as const;
export type Locale = typeof locales[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export function resolveLocale(languages: readonly string[], saved?: string | null): Locale {
  if (isLocale(saved)) return saved;
  for (const language of languages) {
    const tag = language.toLowerCase().replaceAll('_', '-');
    if (/^zh(?:-|$)/.test(tag)) {
      if (tag.includes('hans')) return 'zh-CN';
      if (tag.includes('hant') || /-(tw|hk|mo)(?:-|$)/.test(tag)) return 'zh-TW';
      return 'zh-CN';
    }
    if (/^ja(?:-|$)/.test(tag)) return 'ja';
    if (/^ko(?:-|$)/.test(tag)) return 'ko';
    if (/^en(?:-|$)/.test(tag)) return 'en';
  }
  return 'en';
}

export const localeNames: Record<Locale, string> = { 'zh-TW': '繁體中文', 'zh-CN': '简体中文', ja: '日本語', ko: '한국어', en: 'English' };
export const localeFonts: Record<Locale, string> = {
  'zh-TW': '"Nunito Sans Variable", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
  'zh-CN': '"Nunito Sans Variable", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  ja: '"Nunito Sans Variable", "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif',
  ko: '"Nunito Sans Variable", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif',
  en: '"Nunito Sans Variable", "Nunito Sans", sans-serif',
};
