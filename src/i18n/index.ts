import { localeFonts, resolveLocale, type Locale } from '../../shared/locales';
import { messages, type TextKey } from './messages';

const browserLanguages = () => typeof navigator === 'undefined' ? ['en'] : navigator.languages?.length ? navigator.languages : [navigator.language];
const locale = resolveLocale(browserLanguages());
const columns: Record<Locale, number> = { en: 0, 'zh-TW': 1 };
const catalog = new Map<string, readonly string[]>(messages.map(row => [row[0], row]));

export const getLocale = () => locale;
export function translate(language: Locale, key: TextKey, values: Record<string, string | number> = {}) {
  const text = catalog.get(key)?.[columns[language]] ?? key;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values[name] ?? placeholder));
}
export const t = (key: TextKey, values?: Record<string, string | number>) => translate(locale, key, values);

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale;
  document.documentElement.style.setProperty('--house-font', localeFonts[locale]);
}
