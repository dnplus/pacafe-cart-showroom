import { useSyncExternalStore } from 'react';
import { isLocale, localeFonts, resolveLocale, type Locale } from '../../shared/locales';
import { messages, type TextKey } from './messages';
import { isTimezone } from '../../shared/cafe-day';
import { englishSingular } from './singular';

export const languageStorageKey = 'agent-house-language';
const browserLanguages = () => typeof navigator === 'undefined' ? ['en'] : navigator.languages?.length ? navigator.languages : [navigator.language];
function storedLanguage() { if (typeof window === 'undefined') return null; try { return localStorage.getItem(languageStorageKey); } catch { return null; } }
let locale = resolveLocale(browserLanguages(), storedLanguage());
const listeners = new Set<() => void>();
const columns: Record<Locale, number> = { en: 0, 'zh-TW': 1, 'zh-CN': 2, ja: 3, ko: 4 };
const catalog = new Map<string, readonly string[]>();
for (const row of messages) catalog.set(row[0], row);

export const getLocale = () => locale;

export const timezoneStorageKey = 'agent-house-timezone';
export function browserTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }
function storedTimezone() { if (typeof window === 'undefined') return null; try { return localStorage.getItem(timezoneStorageKey); } catch { return null; } }
const savedTimezone = storedTimezone();
let timezone = isTimezone(savedTimezone) ? savedTimezone : browserTimezone();
const timezoneListeners = new Set<() => void>();
/** The clock this browser shows times in, chosen like the language. Display only: rewards settle on cafe time (shared/cafe-day.ts). */
export const getTimezone = () => timezone;
export function setTimezone(next: string) {
  if (!isTimezone(next)) return;
  try { if (typeof window !== 'undefined') localStorage.setItem(timezoneStorageKey, next); } catch {}
  timezone = next; timezoneListeners.forEach(listener => listener());
}
/** Runs after the display clock changes; returns the unsubscribe. */
export function onTimezoneChange(listener: () => void) { timezoneListeners.add(listener); return () => { timezoneListeners.delete(listener); }; }
export function useTimezone() { return useSyncExternalStore(onTimezoneChange, getTimezone, () => 'UTC'); }

export const formatDate = (at: number | Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone }).format(at);
export const formatDateTime = (at: number | Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(at);
export const localized = (row: readonly string[], language: Locale = locale) => row[columns[language]] ?? row[0];
export function translate(language: Locale, key: TextKey, values: Record<string, string | number> = {}) {
  const text = (language === 'en' && Number(values.count) === 1 ? englishSingular[key] : undefined) ?? catalog.get(key)?.[columns[language]] ?? key;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => String(values[name] ?? placeholder));
}
export const t = (key: TextKey, values?: Record<string, string | number>) => translate(locale, key, values);
export function systemText(text: string) { return catalog.has(text) ? t(text as TextKey) : text; }
export function poolLabel(text: string) {
  const match = /^(Alex|Sam)’s shared pool$/.exec(text);
  return match ? t('{name}’s shared pool', { name: match[1] }) : systemText(text);
}
function applyLanguage() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.style.setProperty('--house-font', localeFonts[locale]);
  document.title = t('PA Cafe · A cafe for you and your agents');
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) { if (field.validity.customError) field.setCustomValidity(t('Please fill in this field.')); }
}
applyLanguage();
export function setLocale(next: Locale) {
  if (!isLocale(next)) return;
  try { if (typeof window !== 'undefined') localStorage.setItem(languageStorageKey, next); } catch {}
  locale = next; applyLanguage(); listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useLocale() { return useSyncExternalStore(subscribe, getLocale, () => 'en' as Locale); }
export function legalHref(path: string, locale: string) { return locale.startsWith('zh') ? path : `${path}?lang=en`; }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== languageStorageKey) return;
  locale = resolveLocale(browserLanguages(), event.newValue); applyLanguage(); listeners.forEach(listener => listener());
});

export function uiError(error: unknown): TextKey {
  if (error instanceof Error && catalog.has(error.message)) return error.message as TextKey;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['HOUSE_FORBIDDEN', 'NOT_HOUSE_OWNER', 'NOT_OWNER', 'NOT_RECIPIENT', 'TASK_FORBIDDEN', 'FORBIDDEN', 'UNAUTHORIZED', 'UNAUTHENTICATED'].includes(code)) return 'This demo identity cannot access that cafe or resident.';
  if (['INVALID_INPUT', 'CONSENT_REQUIRED', 'STATE_REQUIRED', 'TITLE_REQUIRED', 'RESULT_REQUIRED'].includes(code)) return 'Please check the fields and try again.';
  if (code === 'PRIVATE_CARD_UNAVAILABLE') return 'Card pictures pause while the 1F cafe has unfinished private work. Until then, the public link uses the PA Cafe picture.';
  if (code === 'ATTACHMENT_STORAGE_LIMIT') return 'This cafe has reached its attachment storage limit. Existing files are still available.';
  if (code === 'ATTACHMENT_DAILY_LIMIT') return 'This cafe has reached its daily attachment upload limit. Try again after 08:00 Taiwan time (00:00 UTC).';
  if (code === 'ROOM_SCOPE_REQUIRED' || code === 'ROOM_SCOPE_FORBIDDEN') return 'This work belongs to a room you cannot access.';
  if (code === 'STUDIO_EDITOR') return 'This resident cannot work in this room yet. Let them in from the room settings first.';
  if (code === 'NOTHING_TO_RESTORE') return 'Nothing to restore any more.';
  if (code === 'LOCKED_FURNITURE_SPACE') return 'Keep the retained entrance and bedroom furniture clear.';
  if (code === 'LATTE_REQUIRED') return 'This feature requires Latte.';
  if (code === 'SECOND_FLOOR_PAID') return 'Second floor and bedroom pieces are included with Latte.';
  if (code === 'ACTOR_SPACE_RESERVED') return 'Move the resident away before placing furniture here.';
  if (['STAIR_IN_USE','TRAVEL_PENDING'].includes(code)) return 'Wait for stair travel to finish before moving this staircase.';
  if (['STAIR_LANDING_BLOCKED','STAIR_OPENING_BLOCKED','STAIR_OPENING_COVERED','STAIR_OPENING_OUTSIDE_ROOM','NO_SAFE_FLOOR','ACTOR_ROUTE_BLOCKED','ACTION_VERSION_CONFLICT','WRONG_FLOOR'].includes(code)) return 'Keep the stair entrances, openings and paths clear, and use an actor on this floor.';
  if (code === 'IDEMPOTENCY_CONFLICT') return 'This saved request has changed. Close it and start a new handoff.';
  if (code.startsWith('TASK_') || code.startsWith('LEASE_')) return 'This handoff has changed. Refresh the cafe and try again.';
  return 'The cafe is taking a moment. Please try again.';
}

export function validateForm(form: HTMLFormElement) {
  for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[required], textarea[required]')) {
    field.setCustomValidity(field.value.trim() ? '' : t('Please fill in this field.'));
  }
  return form.reportValidity();
}
