import { describe, expect, it } from 'vitest';
import { emptyCart, replaceCart, SHELF_COLUMNS, SHELF_SLOTS, type Cart, type CartItemInput } from '../shared/cart';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { DEFAULT_NICKNAME, shareView, type PriceMode } from '../shared/share';
import { ownerShelf, sharedShelf } from '../src/cart/shelf';
import { t } from '../src/i18n';
import { shelfFrame, shelfSlot } from '../src/room/furnitureModels';

const cartOf = (items: readonly CartItemInput[]) => replaceCart(emptyCart(), items, '2026-10-30T03:00:00.000Z');
const mixed = cartOf([{ title: 'mug', priceTwd: 420, qty: 2 }, { title: 'sample', qty: 1 }, { title: 'chair', priceTwd: 125_000, qty: 1 }]);
const everything = (cart: Cart) => new Set(cart.items.map(item => item.id));
const visitorShelf = (prices: PriceMode, cart = mixed) => sharedShelf(shareView(cart, { slug: 'A'.repeat(22), enabled: true, prices, nickname: DEFAULT_NICKNAME }));

describe('the owner\'s shelf', () => {
  it('shows the cart total on the register, formatted as the room writes amounts', () => {
    expect(ownerShelf(cartOf(fixtureCartItems), everything(cartOf(fixtureCartItems))).register).toBe('NT$ 7,460');
  });
  it('counts quantities and shows zero for an empty cart', () => {
    expect(ownerShelf(cartOf([{ title: 'socks', priceTwd: 1250, qty: 4 }]), new Set()).register).toBe('NT$ 5,000');
    expect(ownerShelf(emptyCart(), new Set()).register).toBe('NT$ 0');
  });
  it('labels every product with its price, or a dash when it has none', () => {
    expect(ownerShelf(mixed, everything(mixed)).items).toEqual([{ title: 'mug', qty: 2, price: 'NT$ 420' }, { title: 'sample', qty: 1, price: '—' }, { title: 'chair', qty: 1, price: 'NT$ 125,000' }]);
  });
});

describe('a visitor\'s shelf', () => {
  it('draws no price and counts items on the register when prices are hidden', () => {
    const shelf = visitorShelf('hidden');
    expect(shelf.items.map(item => item.price)).toEqual([null, null, null]);
    expect(shelf.register).toBe(t('{count} items', { count: 3 }));
    expect(JSON.stringify(shelf)).not.toMatch(/NT\$|420|125/);
  });
  it('draws buckets, open-ended past the last step, when prices are ranges', () => {
    const shelf = visitorShelf('range');
    expect(shelf.items.map(item => item.price)).toEqual(['NT$ 300–500', '—', t('{amount}+', { amount: 'NT$ 100,000' })]);
    expect(shelf.register).toBe(t('{amount}+', { amount: 'NT$ 100,000' }));
    expect(visitorShelf('range', cartOf([{ title: 'sample', qty: 1 }])).register).toBe('—');
  });
  it('draws what the owner sees when prices are exact', () => {
    expect(visitorShelf('exact')).toEqual(ownerShelf(mixed, everything(mixed)));
    expect(visitorShelf('exact', cartOf([{ title: 'sample', qty: 1 }])).register).toBe('—');
  });
});

describe('shelf slots', () => {
  const slots = Array.from({ length: SHELF_SLOTS }, (_, slot) => shelfSlot(slot));
  it('fill the top board left to right before the next board down', () => {
    expect(slots[1].x).toBeGreaterThan(slots[0].x);
    expect(slots[1].y).toBe(slots[0].y);
    expect(slots[SHELF_COLUMNS].y).toBeLessThan(slots[0].y);
    expect(slots[SHELF_COLUMNS].x).toBe(slots[0].x);
  });
  it('give every slot its own place on the shelf', () => {
    expect(new Set(slots.map(at => `${at.x}:${at.y}`)).size).toBe(SHELF_SLOTS);
    for (const at of slots) {
      expect(Math.abs(at.x)).toBeLessThan(shelfFrame.width / 2);
      expect(Math.abs(at.y)).toBeLessThan(shelfFrame.height / 2);
    }
  });
});
