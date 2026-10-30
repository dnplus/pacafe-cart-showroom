import { z } from 'zod';
import type { CartItem } from './cart';

/** One write names at most this many items; the cart itself holds no more than MAX_CART_ITEMS. */
export const MAX_UNBOX_IDS = 50;
const itemId = z.string().min(1).max(80);

/** Which cart items the owner has unboxed, and when. An item with no record is still a parcel on the counter. */
export const unboxStateSchema = z.strictObject({ opened: z.record(itemId, z.iso.datetime()) });
export type UnboxState = z.infer<typeof unboxStateSchema>;
export const unboxWriteSchema = z.strictObject({ itemIds: z.array(itemId).min(1).max(MAX_UNBOX_IDS) });

export const emptyUnbox = (): UnboxState => ({ opened: {} });

/** The records that still name an item in the cart. */
export function openedIn(state: UnboxState, items: readonly CartItem[]): UnboxState {
  const inCart = new Set(items.map(item => item.id));
  return { opened: Object.fromEntries(Object.entries(state.opened).filter(([id]) => inCart.has(id))) };
}

/**
 * `state` with `itemIds` unboxed at `now`. Ids that are not in the cart are ignored, an id already unboxed keeps its first time,
 * and records of items that left the cart are dropped, so the same write twice gives back the same state.
 */
export function markOpened(state: UnboxState, items: readonly CartItem[], itemIds: readonly string[], now: string): UnboxState {
  const { opened } = openedIn(state, items), inCart = new Set(items.map(item => item.id));
  for (const id of itemIds) if (inCart.has(id) && !(id in opened)) opened[id] = now;
  return { opened };
}
