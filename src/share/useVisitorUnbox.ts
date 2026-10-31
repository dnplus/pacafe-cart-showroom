import { useCallback, useState } from 'react';
import { readStoredJson, writeStored } from '../browserStorage';
import { useUnboxFlow } from '../cart/useUnbox';

const storageKey = (slug: string) => `showroom.visitor-unbox.${slug}`;
export const readOpened = (slug: string): ReadonlySet<string> => {
  const stored = readStoredJson(storageKey(slug));
  return new Set(Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string').slice(0, 200) : []);
};

/** The parcels a visitor has opened once `ids` are added, written to their browser only. */
export function rememberOpened(slug: string, before: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
  const next = new Set([...before, ...ids]);
  writeStored(storageKey(slug), JSON.stringify([...next]));
  return next;
}

/**
 * A visitor's own unboxing of a shared cart: the same parcels and animation as the owner's, but what they have opened lives in this browser
 * alone (when it has storage at all), and nothing is sent anywhere, so the owner's unbox record never moves.
 */
export function useVisitorUnbox(slug: string, keys: readonly string[] | null) {
  const [opened, setOpened] = useState(() => readOpened(slug));
  const commit = useCallback(async (ids: string[]) => {
    setOpened(before => rememberOpened(slug, before, ids));
  }, [slug]);
  return useUnboxFlow(keys, opened, commit);
}
