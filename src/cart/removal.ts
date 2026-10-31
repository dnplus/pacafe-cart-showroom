import type { CartItem } from '../../shared/cart';
import type { RemovalReason } from '../../shared/removals';

export const UNDO_MS = 5000;

export interface Pending { item: CartItem; reason: RemovalReason | null }

export const withoutRemoved = (items: readonly CartItem[], hidden: ReadonlySet<string>): CartItem[] => items.filter(item => !hidden.has(item.id));

export function pruneHidden(hidden: ReadonlySet<string>, items: readonly CartItem[]): ReadonlySet<string> {
  const listed = new Set(items.map(item => item.id)), kept = [...hidden].filter(id => listed.has(id));
  return kept.length === hidden.size ? hidden : new Set(kept);
}
