import { useCallback, useEffect, useState } from 'react';
import { cartSchema, type Cart } from '../../shared/cart';
import { ownerFetch } from '../owner';

export const CART_POLL_MS = 2000;

/** Offline keeps the last cart it read, so the room stays as it was while the worker is unreachable. Locked: the worker wants the owner key. */
export type CartState = { status: 'loading' } | { status: 'ready'; cart: Cart } | { status: 'offline'; cart: Cart | null } | { status: 'locked' };

const same = (a: Cart, b: Cart) => a.revision === b.revision && a.updatedAt === b.updatedAt;

/** Reads /api/cart now and every CART_POLL_MS after each answer, until the component unmounts or the worker asks for the owner key; `retry` starts again. */
export function useCart(intervalMs = CART_POLL_MS): { state: CartState; retry: () => void } {
  const [state, setState] = useState<CartState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await ownerFetch('/api/cart', { signal: controller.signal });
        if (response.status === 401) { setState({ status: 'locked' }); return; }
        if (!response.ok) throw new Error(`GET /api/cart answered ${response.status}`);
        const cart = cartSchema.parse(await response.json());
        setState(previous => previous.status === 'ready' && same(previous.cart, cart) ? previous : { status: 'ready', cart });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn(error);
        setState(previous => ({ status: 'offline', cart: previous.status === 'ready' || previous.status === 'offline' ? previous.cart : null }));
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, intervalMs);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [intervalMs, attempt]);
  return { state, retry: useCallback(() => setAttempt(count => count + 1), []) };
}
