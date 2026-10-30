import { z } from 'zod';
import { cartQty, webUrl, type Cart, type CartItem } from './cart';

/** What a visitor learns about prices: nothing, a bucket per item and for the total, or the exact amounts. */
export const priceModes = ['hidden', 'range', 'exact'] as const;
export type PriceMode = typeof priceModes[number];
export const DEFAULT_NICKNAME = '屋主';
export const NICKNAME_MAX = 24;

/** `/s/<slug>`: the only path a visitor can open; anything else under /s gets the same 404. */
export const sharePath = /^\/s\/([A-Za-z0-9_-]{22})$/;
const slug = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const nickname = z.string().trim().min(1).max(NICKNAME_MAX);
const priceMode = z.enum(priceModes);

/** A stored record; one written before visitors had choices (`{ slug, enabled }`) reads as hidden prices and the default nickname. */
export const shareSettingsSchema = z.strictObject({ slug, enabled: z.boolean(), prices: priceMode.default('hidden'), nickname: nickname.default(DEFAULT_NICKNAME) });
export type ShareSettings = z.output<typeof shareSettingsSchema>;
/** The owner's PUT body: every choice at once; the slug is never writable. */
export const shareUpdateSchema = z.strictObject({ enabled: z.boolean(), prices: priceMode, nickname });
export type ShareUpdate = z.output<typeof shareUpdateSchema>;

/** 16 random bytes as unpadded base64url: 22 characters nobody can guess from the showroom's address. Sharing starts off. */
export function newShareSettings(): ShareSettings {
  const slug = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return { slug, enabled: false, prices: 'hidden', nickname: DEFAULT_NICKNAME };
}

export const shareUrl = (origin: string, slug: string) => `${origin}/s/${slug}`;

/** Bucket bounds in NT$; a range shows the step at or below an amount and the next one up. */
export const PRICE_STEPS = [0, 100, 300, 500, 1000, 3000, 5000, 10000, 30000, 50000, 100000] as const;
const twd = z.number().int().nonnegative();
export const priceRangeSchema = z.strictObject({ minTwd: twd, maxTwd: twd.nullable() });
/** `maxTwd` null: past the last step. */
export type PriceRange = z.infer<typeof priceRangeSchema>;
export function priceRange(amount: number): PriceRange {
  const at = PRICE_STEPS.findLastIndex(step => step <= amount);
  return { minTwd: PRICE_STEPS[at], maxTwd: PRICE_STEPS[at + 1] ?? null };
}

/** A product link as a visitor gets it: no query, fragment or credentials, which is where tracking and order ids live. */
export function publicLink(url: string | null) {
  if (url === null) return null;
  const link = new URL(url);
  link.search = ''; link.hash = ''; link.username = ''; link.password = '';
  return link.toString();
}

const item = { title: z.string(), imageUrl: webUrl.nullable(), url: webUrl.nullable(), qty: cartQty };
/**
 * What `/s/<slug>` answers. Each mode is its own strict shape, so a hidden view has no field that could hold a price and a
 * range view none that could hold an exact one. Items are in shelf order; ids, stores and revisions stay with the owner.
 */
export const shareViewSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('hidden'), nickname: z.string(), items: z.array(z.strictObject(item)) }),
  z.strictObject({ mode: z.literal('range'), nickname: z.string(), items: z.array(z.strictObject({ ...item, priceRange: priceRangeSchema.nullable() })), totalRange: priceRangeSchema.nullable() }),
  z.strictObject({ mode: z.literal('exact'), nickname: z.string(), items: z.array(z.strictObject({ ...item, priceTwd: twd.nullable() })), totalTwd: twd.nullable() }),
]);
export type ShareView = z.infer<typeof shareViewSchema>;

/** The cart narrowed to what the owner chose to show. The worker answers visitors with it, and the room draws the card and preview from it. */
export function shareView(cart: Cart, { prices: mode, nickname }: ShareSettings): ShareView {
  const shown = (entry: CartItem) => ({ title: entry.title, imageUrl: entry.cutoutUrl ?? entry.imageUrl, url: publicLink(entry.url), qty: entry.qty });
  const priced = cart.items.filter(entry => entry.priceTwd !== null);
  const total = priced.length ? priced.reduce((sum, entry) => sum + entry.priceTwd! * entry.qty, 0) : null;
  switch (mode) {
    case 'hidden': return { mode, nickname, items: cart.items.map(shown) };
    case 'range': return { mode, nickname, items: cart.items.map(entry => ({ ...shown(entry), priceRange: entry.priceTwd === null ? null : priceRange(entry.priceTwd) })), totalRange: total === null ? null : priceRange(total) };
    case 'exact': return { mode, nickname, items: cart.items.map(entry => ({ ...shown(entry), priceTwd: entry.priceTwd })), totalTwd: total };
  }
}
