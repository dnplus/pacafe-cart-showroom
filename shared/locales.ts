export const locales = ['zh-TW', 'en'] as const;
export type Locale = typeof locales[number];

/** English for browsers that ask for it; 繁體中文 for everyone else, the language this room is made in. */
export function resolveLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const tag = language.toLowerCase().replaceAll('_', '-');
    if (/^zh(?:-|$)/.test(tag)) return 'zh-TW';
    if (/^en(?:-|$)/.test(tag)) return 'en';
  }
  return 'zh-TW';
}

export const localeFonts: Record<Locale, string> = {
  'zh-TW': '"Nunito Sans Variable", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
  en: '"Nunito Sans Variable", "Nunito Sans", sans-serif',
};
