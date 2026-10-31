import { cartView, formatTwd, type Cart } from '../../shared/cart';
import type { PriceRange, ShareView } from '../../shared/share';
import { t } from '../i18n';
import { ownerImageLoader, type ImageLoader } from './productImage';

/** `key` names the product in a click on it: an owner's item id, a visitor's slot number. */
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

export function sharedShelf(view: ShareView, loadImage?: ImageLoader, unboxed?: { opened: ReadonlySet<number>; landed?: ReadonlySet<number> }): Shelf {
  const base = (item: ShareView['items'][number], slot: number, price: string | null): ShelfItem => ({ key: String(slot), title: item.title, qty: item.qty, price, image: item.imageUrl, lands: unboxed?.landed?.has(slot) });
  const drawn = <T extends ShareView['items'][number]>(items: readonly T[], price: (item: T) => string | null) => items.flatMap((item, slot) => !unboxed || unboxed.opened.has(slot) ? [base(item, slot, price(item))] : []);
  switch (view.mode) {
    case 'hidden': return { items: drawn(view.items, () => null), register: t('{count} items', { count: view.items.length }), loadImage };
    case 'range': return { items: drawn(view.items, item => item.priceRange ? formatRange(item.priceRange) : NO_PRICE), register: view.totalRange ? formatRange(view.totalRange) : NO_PRICE, loadImage };
    case 'exact': return { items: drawn(view.items, item => item.priceTwd === null ? NO_PRICE : formatTwd(item.priceTwd)), register: view.totalTwd === null ? NO_PRICE : formatTwd(view.totalTwd), loadImage };
  }
}
