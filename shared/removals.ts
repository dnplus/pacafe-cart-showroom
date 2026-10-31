import { z } from 'zod';
import { cartCategory, type CartItem } from './cart';

/** Why the owner took something out, as the room's chips offer it; the reason is optional. */
export const REMOVAL_REASONS = ['not_my_taste', 'too_expensive', 'already_have', 'changed_mind'] as const;
export const removalReason = z.enum(REMOVAL_REASONS);
export type RemovalReason = z.infer<typeof removalReason>;
/** How Muse is told each reason (the MCP text is in Chinese, like the tools' descriptions). */
export const REMOVAL_REASON_TEXT: Record<RemovalReason, string> = { not_my_taste: '不合口味', too_expensive: '太貴', already_have: '已經有了', changed_mind: '改變主意' };

/** The removal log keeps this many of the owner's latest removals; older ones fall off. */
export const MAX_REMOVALS = 50;
/** cart_list shows the latest this many, newest first. */
export const LISTED_REMOVALS = 20;

export const removalSchema = z.strictObject({
  /** What the item was when it left, enough for Muse to recognise it again. */
  item: z.strictObject({
    title: z.string(),
    url: z.string().nullable(),
    store: z.string().nullable(),
    category: cartCategory.nullable(),
    priceTwd: z.number().nullable(),
  }),
  reason: removalReason.nullable(),
  removedAt: z.iso.datetime(),
  by: z.literal('owner'),
});
export type Removal = z.infer<typeof removalSchema>;
export const removalLogSchema = z.array(removalSchema);

/** What the room sends to take a line out of the cart. */
export const removeRequestSchema = z.strictObject({ itemId: z.string().min(1).max(80), reason: removalReason.optional() });

export const removalOf = (item: CartItem, reason: RemovalReason | null, removedAt: string): Removal => ({
  item: { title: item.title, url: item.url, store: item.store, category: item.category, priceTwd: item.priceTwd },
  reason, removedAt, by: 'owner',
});

/** The log with one more entry last, cut to the latest MAX_REMOVALS. */
export const recordRemoval = (log: readonly Removal[], entry: Removal): Removal[] => [...log, entry].slice(-MAX_REMOVALS);

/** The latest removals, newest first, as cart_list shows them. */
export const recentRemovals = (log: readonly Removal[]): Removal[] => log.slice(-LISTED_REMOVALS).reverse();

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The owner's latest removal of something with this link or this title, if any. */
export const removedBefore = (log: readonly Removal[], item: { title: string; url?: string | null }): Removal | undefined =>
  log.findLast(entry => (item.url != null && entry.item.url === item.url) || sameTitle(entry.item.title, item.title));

/** What cart_add tells Muse about something the owner already removed. */
export const removedNote = (entry: Removal) =>
  `屋主在 ${entry.removedAt.slice(0, 10)} 移除過這件「${entry.item.title}」${entry.reason ? `（原因：${REMOVAL_REASON_TEXT[entry.reason]}）` : '（沒說原因）'}。這次還是記進購物車了；請先問屋主是不是真的還要，不要就用 cart_remove 拿掉。`;
