import { describe, expect, it } from 'vitest';
import { addCartItem, cartSchema, cartView, cartWriteSchema, emptyCart, formatTwd, removeCartItem, replaceCart, SHELF_SLOTS, type CartItemInput } from '../shared/cart';
import { fixtureCartItems } from '../shared/fixtures/cart';

const at = '2026-10-30T03:00:00.000Z', later = '2026-10-30T04:00:00.000Z';
const write = (items: readonly CartItemInput[], previous = emptyCart(), now = at) => replaceCart(previous, items, now);
const things = (n: number) => Array.from({ length: n }, (_, k): CartItemInput => ({ title: `thing ${k}`, priceTwd: 10, qty: 1 }));

describe('cartView', () => {
  it('totals the fixture and fills five of the shelf slots', () => {
    const view = cartView(write(fixtureCartItems).items);
    expect(view.count).toBe(5);
    expect(view.totalTwd).toBe(650 + 3990 + 880 + 1580 + 360);
    expect(view.fill).toBe(5 / SHELF_SLOTS);
  });
  it('multiplies price by quantity', () => {
    expect(cartView(write([{ title: 'socks', priceTwd: 300, qty: 3 }, { title: 'tea', priceTwd: 120, qty: 1 }]).items).totalTwd).toBe(1020);
  });
  it('counts an item without a price as zero', () => {
    expect(cartView(write([{ title: 'mystery box', qty: 2 }, { title: 'mug', priceTwd: 500, qty: 1 }]).items).totalTwd).toBe(500);
  });
  it('caps fill at a full shelf and counts what does not fit', () => {
    expect(cartView(write(things(SHELF_SLOTS)).items)).toMatchObject({ fill: 1, overflow: 0 });
    expect(cartView(write(things(SHELF_SLOTS + 3)).items)).toMatchObject({ fill: 1, overflow: 3, count: SHELF_SLOTS + 3 });
  });
});

describe('replaceCart', () => {
  it('puts items on the shelf in list order and stores the derived total and fill', () => {
    const cart = write(fixtureCartItems);
    expect(cart.items.map(item => [item.title, item.shelfSlot])).toEqual(fixtureCartItems.map((item, slot) => [item.title, slot]));
    expect(cart).toMatchObject({ revision: 1, totalTwd: 7460, fill: 5 / SHELF_SLOTS, updatedAt: at });
  });
  it('gives back the same cart when the same items are written again', () => {
    const first = write(fixtureCartItems);
    expect(write(fixtureCartItems, first, later)).toEqual(first);
  });
  it('keeps an item id and first-seen time while slots follow the new order', () => {
    const first = write(fixtureCartItems);
    const next = write([...fixtureCartItems].reverse(), first, later);
    expect(next.revision).toBe(2);
    expect(next.updatedAt).toBe(later);
    const pan = (cart: typeof first) => cart.items.find(item => item.title === '鑄鐵平底鍋 24cm')!;
    expect(pan(next)).toMatchObject({ id: pan(first).id, addedAt: at, shelfSlot: 1 });
  });
  it('tells two identical lines apart', () => {
    const cart = write([{ title: 'tea', qty: 1 }, { title: 'tea', qty: 1 }]);
    expect(new Set(cart.items.map(item => item.id)).size).toBe(2);
  });
});

describe('addCartItem', () => {
  it('puts a new item last, after the ones already there', () => {
    const cart = addCartItem(write(fixtureCartItems), { title: 'pen', priceTwd: 25, qty: 2 }, later);
    expect(cart.items.map(item => item.title)).toEqual([...fixtureCartItems.map(item => item.title), 'pen']);
    expect(cart.items.at(-1)).toMatchObject({ qty: 2, shelfSlot: 5, addedAt: later });
    expect(cart.revision).toBe(2);
  });
  it('adds to the quantity of the same title, store and link, keeping its id and first-seen time', () => {
    const first = write([{ title: 'tea', store: 'corner shop', priceTwd: 120, qty: 2 }, { title: 'pen', qty: 1 }]);
    const next = addCartItem(first, { title: 'tea', store: 'corner shop', qty: 3 }, later);
    expect(next.items).toHaveLength(2);
    expect(next.items[0]).toMatchObject({ id: first.items[0].id, addedAt: at, qty: 5, priceTwd: 120 });
    expect(addCartItem(first, { title: 'tea', store: 'corner shop', priceTwd: 99, qty: 1 }, later).items[0].priceTwd).toBe(99);
  });
  it('treats another store or link as another item, and stops at the largest quantity', () => {
    const first = write([{ title: 'tea', qty: 998 }]);
    expect(addCartItem(first, { title: 'tea', store: 'elsewhere', qty: 1 }, later).items).toHaveLength(2);
    expect(addCartItem(first, { title: 'tea', qty: 5 }, later).items[0].qty).toBe(999);
  });
});

describe('removeCartItem', () => {
  const cart = write([{ title: 'tea', qty: 3 }, { title: 'pen', qty: 1 }]);
  it('takes some of the quantity off, or the whole line when none or all is asked for', () => {
    expect(removeCartItem(cart, cart.items[0].id, 2, later).items[0]).toMatchObject({ id: cart.items[0].id, qty: 1 });
    expect(removeCartItem(cart, cart.items[0].id, 3, later).items.map(item => item.title)).toEqual(['pen']);
    expect(removeCartItem(cart, cart.items[0].id, undefined, later).items.map(item => item.title)).toEqual(['pen']);
    expect(removeCartItem(cart, cart.items[0].id, 10, later).items).toHaveLength(1);
  });
  it('keeps the totals and shelf slots of what is left', () => {
    const both = write([{ title: 'tea', priceTwd: 100, qty: 1 }, { title: 'pen', priceTwd: 25, qty: 2 }]);
    const dropped = removeCartItem(both, both.items[0].id, undefined, later);
    expect(dropped).toMatchObject({ totalTwd: 50, revision: 2 });
    expect(dropped.items[0]).toMatchObject({ title: 'pen', shelfSlot: 0 });
  });
});

describe('cartWriteSchema', () => {
  it('defaults the quantity to one', () => {
    expect(cartWriteSchema.parse({ items: [{ title: 'pen' }] }).items[0].qty).toBe(1);
  });
  it('refuses links that are not web pages', () => {
    expect(cartWriteSchema.safeParse({ items: [{ title: 'pen', url: 'javascript:alert(1)' }] }).success).toBe(false);
  });
});

describe('formatTwd', () => {
  it('writes amounts the way the register shows them', () => {
    expect(formatTwd(7460)).toBe('NT$ 7,460');
    expect(formatTwd(1234567)).toBe('NT$ 1,234,567');
    expect(formatTwd(0)).toBe('NT$ 0');
  });
});

describe('stored carts from before categories', () => {
  it('still parse, with every item uncategorised', () => {
    const { category: _, ...old } = replaceCart(emptyCart(), [{ title: '馬克杯', qty: 1 }], '2026-10-30T00:00:00.000Z').items[0];
    const cart = cartSchema.parse({ revision: 1, items: [old], totalTwd: 0, fill: 1 / 12, updatedAt: '2026-10-30T00:00:00.000Z' });
    expect(cart.items[0].category).toBeNull();
  });
});
