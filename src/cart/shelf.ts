import { cartView, formatTwd, type Cart } from '../../shared/cart';
import type { PriceRange, ShareView } from '../../shared/share';
import { t } from '../i18n';

/** One product as the room draws it; `price` null draws no price line at all. */
export interface ShelfItem { title: string; qty: number; price: string | null }
/** What the room shows: one item per shelf slot in list order (those past SHELF_SLOTS are not drawn) and the register's display. */
export interface Shelf { items: readonly ShelfItem[]; register: string }

const NO_PRICE = '—';
/** `NT$ 1,000–3,000`, or `NT$ 100,000 以上` past the last step. */
export const formatRange = ({ minTwd, maxTwd }: PriceRange) => maxTwd === null ? t('{amount}+', { amount: formatTwd(minTwd) }) : `${formatTwd(minTwd)}–${maxTwd.toLocaleString('en-US')}`;

/** The owner's room: every price and the cart's total. */
export const ownerShelf = (cart: Cart): Shelf => ({
  items: cart.items.map(item => ({ title: item.title, qty: item.qty, price: item.priceTwd === null ? NO_PRICE : formatTwd(item.priceTwd) })),
  register: formatTwd(cartView(cart.items).totalTwd),
});

/** A visitor's room, drawn from the narrowed view alone, so it can show no more price than the owner chose. */
export function sharedShelf(view: ShareView): Shelf {
  switch (view.mode) {
    case 'hidden': return { items: view.items.map(item => ({ title: item.title, qty: item.qty, price: null })), register: t('{count} items', { count: view.items.length }) };
    case 'range': return { items: view.items.map(item => ({ title: item.title, qty: item.qty, price: item.priceRange ? formatRange(item.priceRange) : NO_PRICE })), register: view.totalRange ? formatRange(view.totalRange) : NO_PRICE };
    case 'exact': return { items: view.items.map(item => ({ title: item.title, qty: item.qty, price: item.priceTwd === null ? NO_PRICE : formatTwd(item.priceTwd) })), register: view.totalTwd === null ? NO_PRICE : formatTwd(view.totalTwd) };
  }
}
