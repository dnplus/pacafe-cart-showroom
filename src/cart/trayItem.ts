import { fingerprint, formatTwd, type CartCategory, type CartItem } from '../../shared/cart';
import { packagingOf, type Packaging } from '../../shared/packaging';
import type { ShareView } from '../../shared/share';
import { formatRange } from './shelf';

export interface TrayItem { id: string; title: string; store: string | null; qty: number; picture: string | null; category: CartCategory | null; url: string | null; price: string | null; note: string | null; packaging: Packaging }

export const ownerTrayItem = (item: CartItem): TrayItem => ({ id: item.id, title: item.title, store: item.store, qty: item.qty, picture: item.cutoutUrl ?? item.imageUrl, category: item.category, url: item.url,
  price: item.priceTwd === null ? null : formatTwd(item.priceTwd), note: item.note ?? null, packaging: packagingOf(item) });

/** A visitor's key for a parcel: stable across reloads, and the same thing twice gets two keys. Slots shift when the owner edits the cart, so they are no key. */
export function visitorKeys(view: ShareView): string[] {
  const seen = new Map<string, number>();
  return view.items.map(item => { const base = fingerprint(JSON.stringify([item.title, item.url])), nth = seen.get(base) ?? 0; seen.set(base, nth + 1); return `v-${base}-${nth}`; });
}

const visitorPrice = (item: ShareView['items'][number]) => 'priceRange' in item ? item.priceRange ? formatRange(item.priceRange) : null : 'priceTwd' in item ? item.priceTwd === null ? null : formatTwd(item.priceTwd) : null;
export function visitorTrayItems(view: ShareView): TrayItem[] {
  const keys = visitorKeys(view);
  return view.items.map((item, slot) => ({ id: keys[slot], title: item.title, store: null, qty: item.qty, picture: item.imageUrl, category: null, url: item.url, price: visitorPrice(item), note: item.note, packaging: item.packaging }));
}
