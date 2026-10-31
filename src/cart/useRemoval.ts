import { useCallback, useEffect, useRef, useState } from 'react';
import { removeRequestSchema, type RemovalReason } from '../../shared/removals';
import type { Cart, CartItem } from '../../shared/cart';
import { ownerFetch } from '../owner';
import { pruneHidden, UNDO_MS, withoutRemoved, type Pending } from './removal';

const send = (id: string, reason: RemovalReason | null, keepalive = false) => ownerFetch('/api/cart/remove', {
  method: 'POST', keepalive, headers: { 'content-type': 'application/json' },
  body: JSON.stringify(removeRequestSchema.parse(reason ? { itemId: id, reason } : { itemId: id })),
});

/**
 * The owner taking lines out of the cart. `ask` opens the reason chips on a line; `confirm` hides it and starts its undo window;
 * `undo` brings it back; when the window ends the removal goes to /api/cart/remove. A removal still waiting when the page closes is sent then.
 * A line stays hidden until the cart poll no longer lists it, and comes back with a note if the worker refuses.
 */
export function useRemoval(cart: Cart | null) {
  const [asking, setAsking] = useState<string | null>(null);
  const [pending, setPending] = useState<readonly Pending[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<CartItem | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const waiting = useRef<readonly Pending[]>([]);
  waiting.current = pending;

  const items = cart?.items;
  useEffect(() => { if (items) setHidden(before => pruneHidden(before, items)); }, [items]);

  const commit = useCallback(async (entry: Pending) => {
    setPending(before => before.filter(p => p.item.id !== entry.item.id));
    try {
      const response = await send(entry.item.id, entry.reason);
      // 404: Muse or another tab already took it out, which is what the owner wanted.
      if (!response.ok && response.status !== 404) throw new Error(`POST /api/cart/remove answered ${response.status}`);
    } catch (error) {
      console.warn(error);
      setHidden(before => { const next = new Set(before); next.delete(entry.item.id); return next; });
      setFailed(entry.item);
    }
  }, []);

  const confirm = useCallback((item: CartItem, reason: RemovalReason | null) => {
    const entry: Pending = { item, reason };
    setAsking(null); setFailed(null);
    setHidden(before => new Set(before).add(item.id));
    setPending(before => [...before.filter(p => p.item.id !== item.id), entry]);
    clearTimeout(timers.current.get(item.id));
    timers.current.set(item.id, setTimeout(() => { timers.current.delete(item.id); void commit(entry); }, UNDO_MS));
  }, [commit]);

  const undo = useCallback((id: string) => {
    clearTimeout(timers.current.get(id)); timers.current.delete(id);
    setPending(before => before.filter(p => p.item.id !== id));
    setHidden(before => { const next = new Set(before); next.delete(id); return next; });
  }, []);

  useEffect(() => {
    const flush = () => { for (const entry of waiting.current) void send(entry.item.id, entry.reason, true).catch(() => undefined); };
    addEventListener('pagehide', flush);
    return () => { removeEventListener('pagehide', flush); timers.current.forEach(clearTimeout); flush(); };
  }, []);

  return {
    asking, pending, failed,
    ask: useCallback((id: string | null) => setAsking(id), []),
    dismissFailure: useCallback(() => setFailed(null), []),
    confirm, undo,
    visible: (list: readonly CartItem[]) => withoutRemoved(list, hidden),
  };
}
export type RemovalController = ReturnType<typeof useRemoval>;
