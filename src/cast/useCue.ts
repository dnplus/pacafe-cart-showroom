import { useEffect, useRef, useState } from 'react';
import type { Cart } from '../../shared/cart';
import { cartCue, type CartSnapshot, type Cue } from '../room/castMotion';

/** `synced` is true once the unbox record covers every item in the cart; nothing fires before that, so opening the room is not news. */
export function useCue(cart: Cart | null, shelved: number, synced: boolean) {
  const [cue, setCue] = useState<{ id: number; kind: Cue } | null>(null);
  const seen = useRef<CartSnapshot | null>(null);
  const items = cart?.items.length ?? null;
  useEffect(() => {
    if (items === null || !synced) return;
    const next = { items, shelved }, kind = cartCue(seen.current, next);
    seen.current = next;
    if (kind) setCue(previous => ({ id: (previous?.id ?? 0) + 1, kind }));
  }, [items, shelved, synced]);
  return cue;
}
