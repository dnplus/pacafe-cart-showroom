import { jsonOrNull } from '../shared/safe-decode';

type StorageArea = 'local' | 'session';
const unavailable = (error: unknown) => error instanceof DOMException;
function storageArea(area: StorageArea): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return area === 'local' ? window.localStorage : window.sessionStorage; } catch (error) { if (unavailable(error)) return null; throw error; }
}
export function readStored(key: string, area: StorageArea = 'local'): string | null {
  const storage = storageArea(area); if (!storage) return null;
  try { return storage.getItem(key); } catch (error) { if (unavailable(error)) return null; throw error; }
}
export function readStoredJson(key: string, area: StorageArea = 'local'): unknown {
  const text = readStored(key, area);
  return text === null ? null : jsonOrNull(text);
}
export function writeStored(key: string, value: string | null, area: StorageArea = 'local'): boolean {
  const storage = storageArea(area); if (!storage) return false;
  try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); return true; } catch (error) { if (unavailable(error)) return false; throw error; }
}
