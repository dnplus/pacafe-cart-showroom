import { useEffect, useState } from 'react';
import { cartSchema, type Cart } from '../../shared/cart';

export const CART_POLL_MS = 2000;

/** Offline keeps the last cart it read, so the room stays as it was while the worker is unreachable. */
export type CartState = { status: 'loading' } | { status: 'ready'; cart: Cart } | { status: 'offline'; cart: Cart | null };

const same = (a: Cart, b: Cart) => a.revision === b.revision && a.updatedAt === b.updatedAt;

/** Reads /api/cart now and every CART_POLL_MS after each answer, until the component unmounts. */
export function useCart(intervalMs = CART_POLL_MS): CartState {
  const [state, setState] = useState<CartState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch('/api/cart', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`GET /api/cart answered ${response.status}`);
        const cart = cartSchema.parse(await response.json());
        setState(previous => previous.status === 'ready' && same(previous.cart, cart) ? previous : { status: 'ready', cart });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn(error);
        setState(previous => ({ status: 'offline', cart: previous.status === 'loading' ? null : previous.cart }));
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, intervalMs);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [intervalMs]);
  return state;
}
