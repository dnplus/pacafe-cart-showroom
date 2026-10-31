import { z } from 'zod';

/**
 * The cart is Muse 採買時記下的東西: things the owner's own Muse noted while shopping. The showroom only draws them on a
 * shelf. It does not buy anything, has no checkout, and is not connected to Muse's shopping.
 */
export const SHELF_ROWS = 3;
export const SHELF_COLUMNS = 4;
/** Each item takes one shelf slot, in list order; fill is the share of these slots taken, capped at 1. */
export const SHELF_SLOTS = SHELF_ROWS * SHELF_COLUMNS;
/** The most items one write may hold; the ones past SHELF_SLOTS count in the total but have no room on the shelf. */
export const MAX_CART_ITEMS = 50;

export const webUrl = z.url({ protocol: /^https?$/ }).max(2000);
const timestamp = z.iso.datetime();
const priceTwd = z.number().int().nonnegative().max(100_000_000);
const MAX_QTY = 999;
export const NOTE_MAX = 80;
export const noteText = z.string().trim().min(1).max(NOTE_MAX);
export const cartQty = z.number().int().min(1).max(MAX_QTY);

export const CART_CATEGORIES = ['fashion', 'beauty', 'electronics', 'home', 'kitchen', 'food', 'books', 'hobby', 'outdoor', 'other'] as const;
export const cartCategory = z.enum(CART_CATEGORIES);
export type CartCategory = z.infer<typeof cartCategory>;

export const cartItemSchema = z.strictObject({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  store: z.string().max(100).nullable(),
  url: webUrl.nullable(),
  priceTwd: priceTwd.nullable(),
  imageUrl: webUrl.nullable(),
  /** The item's image with its background removed (SAM), once that job has run. */
  cutoutUrl: webUrl.nullable(),
  /** Carts stored before categories existed have no such key; they read as uncategorised. */
  category: cartCategory.nullable().default(null),
  /** Muse's one sentence on why it picked this for the owner; carts stored before notes existed read as no note. */
  note: noteText.nullable().default(null),
  qty: cartQty,
  addedAt: timestamp,
  shelfSlot: z.number().int().nonnegative(),
});
export type CartItem = z.infer<typeof cartItemSchema>;

export const cartSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  items: z.array(cartItemSchema),
  totalTwd: z.number().int().nonnegative(),
  fill: z.number().min(0).max(1),
  updatedAt: timestamp,
});
export type Cart = z.infer<typeof cartSchema>;

/** What a writer sends for one item (qty defaults to 1); the showroom fills in the id, the time it was first seen and its shelf slot. */
export const cartItemInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  store: z.string().trim().min(1).max(100).optional(),
  url: webUrl.optional(),
  priceTwd: priceTwd.optional(),
  imageUrl: webUrl.optional(),
  category: cartCategory.optional(),
  note: noteText.optional(),
  qty: cartQty.default(1),
});
export type CartItemInput = z.output<typeof cartItemInputSchema>;
export const cartWriteSchema = z.strictObject({ items: z.array(cartItemInputSchema).max(MAX_CART_ITEMS) });

/** Everything the room shows about a cart, derived from its items alone. */
export function cartView(items: readonly CartItem[]) {
  const totalTwd = items.reduce((sum, item) => sum + (item.priceTwd ?? 0) * item.qty, 0);
  return { count: items.length, totalTwd, fill: Math.min(1, items.length / SHELF_SLOTS), overflow: Math.max(0, items.length - SHELF_SLOTS) };
}

/** `NT$ 12,340`: how the register and the room's labels write an amount. */
export const formatTwd = (amount: number) => `NT$ ${Math.round(amount).toLocaleString('en-US')}`;

export const emptyCart = (): Cart => ({ revision: 0, items: [], totalTwd: 0, fill: 0, updatedAt: new Date(0).toISOString() });

/** FNV-1a: a short, stable name for an item's identity, so the same thing keeps its id and first-seen time across writes. */
export function fingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
}

const identityOf = (entry: { title: string; store?: string | null; url?: string | null }) => fingerprint(JSON.stringify([entry.title, entry.store ?? null, entry.url ?? null]));
const asInput = (item: CartItem): CartItemInput => ({ title: item.title, store: item.store ?? undefined, url: item.url ?? undefined, priceTwd: item.priceTwd ?? undefined, imageUrl: item.imageUrl ?? undefined, category: item.category ?? undefined, note: item.note ?? undefined, qty: item.qty });

/**
 * The cart after a write that replaces its items: the same write twice gives back the same cart, revision included.
 * An item keeps its id and `addedAt` while its title, store and link stay the same; slots follow the list order.
 */
export function replaceCart(previous: Cart, input: readonly CartItemInput[], now: string): Cart {
  const seen = new Map<string, number>();
  const items = input.map((entry, shelfSlot): CartItem => {
    const identity = identityOf(entry);
    const nth = seen.get(identity) ?? 0; seen.set(identity, nth + 1);
    const id = `item-${identity}-${nth}`, before = previous.items.find(item => item.id === id);
    return { id, title: entry.title, store: entry.store ?? null, url: entry.url ?? null, priceTwd: entry.priceTwd ?? null, imageUrl: entry.imageUrl ?? null,
      cutoutUrl: before && before.imageUrl === (entry.imageUrl ?? null) ? before.cutoutUrl : null, category: entry.category ?? null, note: entry.note ?? null, qty: entry.qty, addedAt: before?.addedAt ?? now, shelfSlot };
  });
  if (JSON.stringify(items) === JSON.stringify(previous.items)) return previous;
  const { totalTwd, fill } = cartView(items);
  return { revision: previous.revision + 1, items, totalTwd, fill, updatedAt: now };
}

/** The cart with one more of `input`: a line of the same title, store and link takes the quantity (and a newly given price or image), else the item goes last. */
export function addCartItem(cart: Cart, input: CartItemInput, now: string): Cart {
  const lines = cart.items.map(asInput), at = cart.items.findIndex(item => identityOf(item) === identityOf(input));
  if (at < 0) lines.push(input);
  else lines[at] = { ...lines[at], qty: Math.min(MAX_QTY, lines[at].qty + input.qty), priceTwd: input.priceTwd ?? lines[at].priceTwd, imageUrl: input.imageUrl ?? lines[at].imageUrl, category: input.category ?? lines[at].category, note: input.note ?? lines[at].note };
  return replaceCart(cart, lines, now);
}

/** The cart with `qty` fewer of a line, or without it when `qty` is absent or covers all of it. */
export function removeCartItem(cart: Cart, itemId: string, qty: number | undefined, now: string): Cart {
  const lines = cart.items.flatMap(item => item.id !== itemId ? [asInput(item)] : qty === undefined || qty >= item.qty ? [] : [{ ...asInput(item), qty: item.qty - qty }]);
  return replaceCart(cart, lines, now);
}
