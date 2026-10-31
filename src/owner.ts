import { z } from 'zod';
import { readStored, writeStored } from './browserStorage';

const OWNER_KEY = 'showroom.ownerKey';
export const hasOwnerKey = () => readStored(OWNER_KEY) !== null;
export const ownerKey = () => readStored(OWNER_KEY);
export const saveOwnerKey = (key: string) => writeStored(OWNER_KEY, key.trim() || null);

/** fetch for the owner's routes (/api/cart, /api/share): sends the saved key as a bearer token. env.local answers without one. */
export function ownerFetch(path: string, init: RequestInit = {}) {
  const key = readStored(OWNER_KEY), headers = new Headers(init.headers);
  if (key) headers.set('authorization', `Bearer ${key}`);
  return fetch(path, { cache: 'no-store', ...init, headers });
}

export class OwnerRefused extends Error { constructor(readonly status: number, method: string, path: string) { super(`${method} ${path} answered ${status}`); } }

/** ownerFetch that throws OwnerRefused unless the answer is ok, then returns the body parsed by `schema`. */
export async function ownerJson<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}): Promise<z.output<S>> {
  const response = await ownerFetch(path, init);
  if (!response.ok) throw new OwnerRefused(response.status, init.method ?? 'GET', path);
  return schema.parse(await response.json());
}

/** What the worker's error answers carry: a code, and for some a message. */
export const failureSchema = z.object({ error: z.string().optional(), message: z.string().optional() });
