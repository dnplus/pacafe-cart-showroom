import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCartItem, cartItemSchema, cartSchema, cartWriteSchema, emptyCart, NOTE_MAX, replaceCart, type CartItem } from '../shared/cart';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { BOXES, packagingOf, STICKER_ONE_IN, STICKERS } from '../shared/packaging';
import { shareView, shareViewSchema, visitorNote, type ShareSettings } from '../shared/share';
import { sharedShelf } from '../src/cart/shelf';
import { ownerTrayItem, visitorKeys, visitorTrayItems } from '../src/cart/trayItem';
import { readOpened, rememberOpened } from '../src/share/useVisitorUnbox';

const at = '2026-10-30T03:00:00.000Z';
const cartOf = (...items: Parameters<typeof replaceCart>[1]) => replaceCart(emptyCart(), items, at);
const settings = (prices: ShareSettings['prices']): ShareSettings => ({ slug: 'a'.repeat(22), enabled: true, prices, nickname: '屋主' });
const { id: _id, ...legacy } = cartOf({ title: '杯子', qty: 1 }).items[0];

describe('Muse note', () => {
  it('reads a stored item without one as no note, and a cart stored before notes parses', () => {
    const { note: _note, ...oldItem } = cartOf({ title: '杯子', qty: 1 }).items[0];
    expect(cartItemSchema.parse(oldItem).note).toBeNull();
    expect(cartSchema.parse({ revision: 1, items: [oldItem], totalTwd: 0, fill: 0, updatedAt: at }).items[0].note).toBeNull();
    expect(legacy.note).toBeNull();
  });

  it('is optional, trimmed and at most NOTE_MAX characters when written', () => {
    expect(cartWriteSchema.parse({ items: [{ title: 'a' }] }).items[0].note).toBeUndefined();
    expect(cartWriteSchema.parse({ items: [{ title: 'a', note: '  給你  ' }] }).items[0].note).toBe('給你');
    expect(cartWriteSchema.safeParse({ items: [{ title: 'a', note: 'x'.repeat(NOTE_MAX + 1) }] }).success).toBe(false);
    expect(cartWriteSchema.safeParse({ items: [{ title: 'a', note: '   ' }] }).success).toBe(false);
  });

  it('is kept across writes, and a repeated add keeps it unless a new one comes', () => {
    const first = addCartItem(emptyCart(), { title: '杯子', note: '早上用', qty: 1 }, at);
    expect(first.items[0].note).toBe('早上用');
    expect(addCartItem(first, { title: '杯子', qty: 1 }, at).items[0]).toMatchObject({ note: '早上用', qty: 2 });
    expect(addCartItem(first, { title: '杯子', note: '送人也好', qty: 1 }, at).items[0].note).toBe('送人也好');
    expect(cartOf({ title: '杯子', note: '早上用', qty: 1 }).items[0].note).toBe('早上用');
  });

  it('reaches a visitor, but never carries a price past a hidden or banded view', () => {
    const cart = cartOf({ title: '耳機', priceTwd: 3990, note: '通勤時戴著很安靜', qty: 1 }, { title: '鍋', priceTwd: 1580, note: '特價才 1580 元', qty: 1 });
    const hidden = shareView(cart, settings('hidden')), range = shareView(cart, settings('range')), exact = shareView(cart, settings('exact'));
    expect(hidden.items.map(item => item.note)).toEqual(['通勤時戴著很安靜', null]);
    expect(range.items.map(item => item.note)).toEqual(['通勤時戴著很安靜', null]);
    expect(exact.items.map(item => item.note)).toEqual(['通勤時戴著很安靜', '特價才 1580 元']);
    expect(JSON.stringify([hidden, range])).not.toMatch(/1580|3990/);
    expect(visitorNote('NT$ 99 就買到', 'range')).toBeNull();
    expect(visitorNote(undefined, 'exact')).toBeNull();
  });
});

describe('packaging', () => {
  const item = (over: Partial<CartItem> = {}) => ({ ...cartOf({ title: 'x', qty: 1 }).items[0], ...over });

  it('is the same for the same item every time, and follows the store', () => {
    const a = item({ id: 'item-a-0', store: '小島陶房', category: 'kitchen' });
    expect(packagingOf(a)).toEqual(packagingOf({ ...a }));
    const sameShop = packagingOf(item({ id: 'item-b-0', store: '小島陶房', category: 'home' }));
    expect(sameShop).toMatchObject({ box: packagingOf(a).box, tape: packagingOf(a).tape });
  });

  it('differs between stores and between categories', () => {
    const stores = new Set(['山嵐咖啡器材', '青田電器行', '巷口布作', '灶腳生活', '小雨書店', '海邊雜貨', '森林麵包', '月光文具'].map(store => packagingOf(item({ store })).box));
    expect(stores.size).toBeGreaterThanOrEqual(4);
    expect(new Set(['kitchen', 'electronics', 'fashion', 'books', 'food'].map(category => packagingOf(item({ category: category as CartItem['category'] })).filler)).size).toBe(5);
  });

  it('puts a sticker in about one parcel in four, decided by the id alone', () => {
    const ids = Array.from({ length: 2000 }, (_, k) => `item-${k.toString(36)}-0`);
    const stickered = ids.filter(id => packagingOf(item({ id })).sticker);
    expect(stickered.length / ids.length).toBeGreaterThan(0.2);
    expect(stickered.length / ids.length).toBeLessThan(0.3);
    expect(1 / STICKER_ONE_IN).toBe(0.25);
    expect(new Set(stickered.map(id => packagingOf(item({ id })).sticker)).size).toBe(STICKERS.length);
    expect(packagingOf(item({ id: stickered[0], store: 'A' })).sticker).toBe(packagingOf(item({ id: stickered[0], store: 'B' })).sticker);
  });

  it('shows at least one sticker and several boxes in the demo cart', () => {
    const packs = cartOf(...fixtureCartItems).items.map(packagingOf);
    expect(packs.some(pack => pack.sticker)).toBe(true);
    expect(new Set(packs.map(pack => pack.box)).size).toBeGreaterThan(2);
    expect(packs.every(pack => BOXES.includes(pack.box))).toBe(true);
  });
});

describe('a visitor unboxing', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const cart = cartOf(...fixtureCartItems, { title: fixtureCartItems[0].title, store: fixtureCartItems[0].store, url: `${fixtureCartItems[0].url}?v=2`, priceTwd: 100, qty: 1 });

  it('gets the owner\'s items as parcels with no id, store or category, and an exact price only in exact mode', () => {
    for (const prices of ['hidden', 'range', 'exact'] as const) {
      const view = shareViewSchema.parse(shareView(cart, settings(prices)));
      const text = JSON.stringify(view), parcels = visitorTrayItems(view);
      expect(text).not.toMatch(/item-|山嵐|青田|kitchen|electronics|"id"/);
      expect(parcels.map(parcel => parcel.price === null)).toEqual(prices === 'hidden' ? parcels.map(() => true) : parcels.map(() => false));
      expect(parcels.every(parcel => parcel.store === null && parcel.category === null)).toBe(true);
      if (prices !== 'exact') expect(parcels.map(parcel => parcel.price).join()).not.toMatch(/3,990|650/);
    }
  });

  it('keys duplicates apart and keeps the keys when the owner appends an item', () => {
    const twice = cartOf({ title: '杯子', qty: 1 }, { title: '杯子', qty: 1 }), view = shareView(twice, settings('hidden'));
    const keys = visitorKeys(view);
    expect(new Set(keys).size).toBe(2);
    expect(visitorKeys(shareView(cartOf({ title: '杯子', qty: 1 }, { title: '杯子', qty: 1 }, { title: '新的', qty: 1 }), settings('hidden'))).slice(0, 2)).toEqual(keys);
  });

  it('draws only the parcels the visitor opened, with the register still counting all', () => {
    const view = shareView(cart, settings('hidden'));
    expect(sharedShelf(view).items).toHaveLength(6);
    const shelf = sharedShelf(view, undefined, { opened: new Set([1, 4]), landed: new Set([4]) });
    expect(shelf.items.map(entry => [entry.key, entry.lands])).toEqual([['1', false], ['4', true]]);
    expect(shelf.register).toBe('6 items');
    expect(sharedShelf(view, undefined, { opened: new Set() }).items).toEqual([]);
  });

  it('remembers what was opened in this browser only, and tolerates a browser without storage', () => {
    const fetched = vi.fn(); vi.stubGlobal('fetch', fetched);
    const store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });
    expect([...readOpened('slug-a')]).toEqual([]);
    const opened = rememberOpened('slug-a', readOpened('slug-a'), ['v-1-0', 'v-2-0']);
    expect([...opened]).toEqual(['v-1-0', 'v-2-0']);
    expect([...readOpened('slug-a')]).toEqual(['v-1-0', 'v-2-0']);
    expect([...readOpened('slug-b')]).toEqual([]);
    store.set('showroom.visitor-unbox.slug-c', '{broken'); expect([...readOpened('slug-c')]).toEqual([]);
    vi.stubGlobal('window', { get localStorage(): Storage { throw new DOMException('denied', 'SecurityError'); } });
    expect([...rememberOpened('slug-a', new Set(['x']), ['y'])]).toEqual(['x', 'y']);
    expect(fetched).not.toHaveBeenCalled();
  });

  it('never talks to an owner endpoint', () => {
    const source = readFileSync(new URL('../src/share/useVisitorUnbox.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/ownerFetch|fetch\(|\/api\//);
  });
});

describe('the owner\'s tray item', () => {
  it('carries the note, the price and the packaging', () => {
    const [first] = cartOf({ title: '耳機', store: '青田電器行', priceTwd: 3990, note: '很安靜', category: 'electronics', qty: 1 }).items;
    expect(ownerTrayItem(first)).toMatchObject({ title: '耳機', price: 'NT$ 3,990', note: '很安靜', packaging: packagingOf(first) });
  });
});
