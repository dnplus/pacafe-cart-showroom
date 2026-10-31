import { localeFonts, locales, resolveLocale, type Locale } from '../../shared/locales';
import { nicknameIn } from '../../shared/share';
import { readStored, writeStored } from '../browserStorage';
import { messages, type TextKey } from './messages';

const browserLanguages = () => typeof navigator === 'undefined' ? ['en'] : navigator.languages?.length ? navigator.languages : [navigator.language];
const CHOSEN_KEY = 'showroom.locale';
const isLocale = (value: string | null): value is Locale => (locales as readonly string[]).includes(value ?? '');
function chosenLocale(): Locale | null {
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('lang');
  if (isLocale(asked)) return asked;
  const stored = readStored(CHOSEN_KEY);
  return isLocale(stored) ? stored : null;
}
const locale = chosenLocale() ?? resolveLocale(browserLanguages());
const columns: Record<Locale, number> = { en: 0, 'zh-TW': 1 };
const catalog = new Map<string, readonly string[]>(messages.map(row => [row[0], row]));

export const getLocale = () => locale;
export function setLocale(next: Locale) {
  writeStored(CHOSEN_KEY, next);
  const url = new URL(location.href); url.searchParams.delete('lang');
  location.replace(url);
}
const singular: Partial<Record<TextKey, string>> = {
  '{count} more do not fit on the shelf': '{count} more does not fit on the shelf', '{count} items': '{count} item', '{count} things': '{count} thing',
  '{count} lines': '{count} line', '{count} lines have no store.': '{count} line has no store.', 'Shelf: {count} items. Show the list': 'Shelf: {count} item. Show the list',
};
export function translate(language: Locale, key: TextKey, values: Record<string, string | number> = {}) {
  const text = language === 'en' && values.count === 1 && singular[key] || (catalog.get(key)?.[columns[language]] ?? key);
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values[name] ?? placeholder));
}
export const t = (key: TextKey, values?: Record<string, string | number>) => translate(locale, key, values);
export const shownNickname = (nickname: string) => nicknameIn(nickname, locale);

if (typeof document !== 'undefined') {
  document.documentElement.lang = locale;
  document.documentElement.style.setProperty('--house-font', localeFonts[locale]);
  document.title = translate(locale, 'Cart showroom');
}
