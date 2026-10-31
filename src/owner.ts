import { readStored, writeStored } from './browserStorage';

const OWNER_KEY = 'showroom.ownerKey';
export const hasOwnerKey = () => readStored(OWNER_KEY) !== null;
/** The saved key, for the Muse settings the connections panel hands out; null where the room opens without one. */
export const ownerKey = () => readStored(OWNER_KEY);
export const saveOwnerKey = (key: string) => writeStored(OWNER_KEY, key.trim() || null);

/** fetch for the owner's routes (/api/cart, /api/share): sends the saved key as a bearer token. env.local answers without one. */
export function ownerFetch(path: string, init: RequestInit = {}) {
  const key = readStored(OWNER_KEY), headers = new Headers(init.headers);
  if (key) headers.set('authorization', `Bearer ${key}`);
  return fetch(path, { cache: 'no-store', ...init, headers });
}
