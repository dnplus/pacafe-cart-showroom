import { cartView, formatTwd, type Cart } from '../../shared/cart';
import type { PriceRange, ShareView } from '../../shared/share';
import { t } from '../i18n';
import { ownerImageLoader, type ImageLoader } from './productImage';

/**
 * One product as the room draws it; `price` null draws no price line at all. `key` names the product in a click on it (an owner's item id,
 * a visitor's slot number), and `image` is its picture's address, drawn on the box once `Shelf.loadImage` has brought it in.
 */
export interface ShelfItem { key: string; title: string; qty: number; price: string | null; image: string | null; /** Just unboxed in this room: the box drops onto its slot instead of standing there already. */ lands?: boolean }
/** What the room shows: one item per shelf slot in list order (those past SHELF_SLOTS are not drawn) and the register's display. */
export interface Shelf { items: readonly ShelfItem[]; register: string; loadImage?: ImageLoader }

const NO_PRICE = '—';
/** `NT$ 1,000–3,000`, or `NT$ 100,000 以上` past the last step. */
export const formatRange = ({ minTwd, maxTwd }: PriceRange) => maxTwd === null ? t('{amount}+', { amount: formatTwd(minTwd) }) : `${formatTwd(minTwd)}–${maxTwd.toLocaleString('en-US')}`;

/** The owner's room: every price and the cart's total. Only items already unboxed stand on the shelf; the register counts the whole cart. */
export const ownerShelf = (cart: Cart, unboxed: ReadonlySet<string>, landed: ReadonlySet<string> = new Set()): Shelf => ({
  items: cart.items.filter(item => unboxed.has(item.id)).map(item => ({ key: item.id, title: item.title, qty: item.qty, price: item.priceTwd === null ? NO_PRICE : formatTwd(item.priceTwd), image: item.cutoutUrl ?? item.imageUrl, lands: landed.has(item.id) })),
  register: formatTwd(cartView(cart.items).totalTwd),
  loadImage: ownerImageLoader,
});

/**
 * A visitor's room, drawn from the narrowed view alone, so it can show no more price than the owner chose. Without `loadImage`
 * the boxes carry no pictures; products are keyed by slot, the same order the visitor's list shows.
 */
export function sharedShelf(view: ShareView, loadImage?: ImageLoader): Shelf {
  const base = (item: ShareView['items'][number], slot: number, price: string | null): ShelfItem => ({ key: String(slot), title: item.title, qty: item.qty, price, image: item.imageUrl });
  switch (view.mode) {
    case 'hidden': return { items: view.items.map((item, slot) => base(item, slot, null)), register: t('{count} items', { count: view.items.length }), loadImage };
    case 'range': return { items: view.items.map((item, slot) => base(item, slot, item.priceRange ? formatRange(item.priceRange) : NO_PRICE)), register: view.totalRange ? formatRange(view.totalRange) : NO_PRICE, loadImage };
    case 'exact': return { items: view.items.map((item, slot) => base(item, slot, item.priceTwd === null ? NO_PRICE : formatTwd(item.priceTwd))), register: view.totalTwd === null ? NO_PRICE : formatTwd(view.totalTwd), loadImage };
  }
}
