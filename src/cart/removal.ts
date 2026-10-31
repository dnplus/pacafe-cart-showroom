import type { CartItem } from '../../shared/cart';
import type { RemovalReason } from '../../shared/removals';

/** How long the owner can take a removal back before it is sent to the worker. */
export const UNDO_MS = 5000;

/** A removal the owner has chosen a reason for (or skipped) and may still undo. */
export interface Pending { item: CartItem; reason: RemovalReason | null }

/** The cart's lines without the ones waiting out their undo window or sent and not yet gone from the poll. */
export const withoutRemoved = (items: readonly CartItem[], hidden: ReadonlySet<string>): CartItem[] => items.filter(item => !hidden.has(item.id));

/** `hidden` keeps only ids the cart still lists: once the poll shows a line gone, nothing needs hiding. */
export function pruneHidden(hidden: ReadonlySet<string>, items: readonly CartItem[]): ReadonlySet<string> {
  const listed = new Set(items.map(item => item.id)), kept = [...hidden].filter(id => listed.has(id));
  return kept.length === hidden.size ? hidden : new Set(kept);
}
