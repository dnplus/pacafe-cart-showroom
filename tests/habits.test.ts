import { describe, expect, it } from 'vitest';
import type { CartItem } from '../shared/cart';
import { habitsReport } from '../shared/habits';
import { emptyUnbox } from '../shared/unbox';

const NOW = '2026-11-10T04:00:00.000Z';
let n = 0;
const item = (over: Partial<CartItem> = {}): CartItem => ({
  id: `item-${++n}`, title: `東西 ${n}`, store: null, url: null, priceTwd: null, imageUrl: null, cutoutUrl: null, category: null, qty: 1,
  addedAt: '2026-11-09T04:00:00.000Z', shelfSlot: 0, ...over,
});

describe('habitsReport', () => {
  it('gives an honest, empty report for an empty cart', () => {
    const report = habitsReport([], emptyUnbox(), NOW);
    expect(report.totals).toEqual({ lines: 0, units: 0, spendTwd: 0, pricedLines: 0, unpricedLines: 0, averageTwd: null });
    expect(report.biggest).toBeNull();
    expect(report.categories).toEqual([]);
    expect(report.stores).toEqual([]);
    expect(report.parcels).toEqual({ opened: 0, unopened: 0, unopenedSpendTwd: 0, oldestUnopened: null });
    expect(report.observations).toEqual([]);
    expect(report.scope).toBe('cart_now');
    expect(report.note).toContain('已經移除的不在內');
  });

  it('counts missing prices and categories without inventing numbers', () => {
    const report = habitsReport([item({ priceTwd: 400, qty: 2 }), item(), item({ category: 'home', priceTwd: 600 })], emptyUnbox(), NOW);
    expect(report.totals).toMatchObject({ lines: 3, units: 4, spendTwd: 1400, pricedLines: 2, unpricedLines: 1, averageTwd: 700 });
    expect(report.biggest).toMatchObject({ amountTwd: 800 });
    expect(report.categories.map(row => [row.key, row.label, row.lines, row.spendTwd])).toEqual([['uncategorized', '未分類', 2, 800], ['home', '居家生活', 1, 600]]);
    expect(report.categories[0].share).toBeCloseTo(800 / 1400);
    expect(report.observations.join('')).toContain('有 1 筆沒標價');
  });

  it('breaks ties the same way every time and draws no dominant-category claim from a tie', () => {
    const cart = [item({ category: 'food', priceTwd: 500, store: '乙店' }), item({ category: 'books', priceTwd: 500, store: '甲店' }), item({ category: 'beauty', priceTwd: 500, store: '丙店' })];
    const report = habitsReport(cart, emptyUnbox(), NOW);
    expect(report.categories.map(row => row.key)).toEqual(['beauty', 'food', 'books']);
    expect(report.stores.map(row => row.store)).toEqual(['乙店', '甲店', '丙店']);
    expect(habitsReport([...cart].reverse(), emptyUnbox(), NOW).categories.length).toBe(3);
    expect(report.observations.some(text => text.includes('花得最多'))).toBe(false);
  });

  it('names the category that dominates spend', () => {
    const report = habitsReport([item({ category: 'electronics', priceTwd: 3990 }), item({ category: 'books', priceTwd: 360 }), item({ category: 'home', priceTwd: 600 })], emptyUnbox(), NOW);
    expect(report.observations[0]).toBe('3C 家電花得最多，NT$ 3,990，占總額的 81%。');
  });

  it('puts prices in bands by line amount and lists at most five stores', () => {
    const cart = [100, 300, 999, 1000, 2999, 3000].map(priceTwd => item({ priceTwd }));
    expect(habitsReport(cart, emptyUnbox(), NOW).priceBands.map(band => band.lines)).toEqual([1, 2, 2, 1]);
    const stores = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((store, i) => item({ store, priceTwd: 100 * (i + 1) }));
    const report = habitsReport([...stores, item()], emptyUnbox(), NOW);
    expect(report.stores.map(row => row.store)).toEqual(['g', 'f', 'e', 'd', 'c']);
    expect(report.withoutStore).toBe(1);
  });

  it('reads weekday and time of day in Taiwan time', () => {
    // 2026-11-08 17:30 UTC is Monday 2026-11-09 01:30 in Taipei.
    const report = habitsReport([item({ addedAt: '2026-11-08T17:30:00.000Z' }), item({ addedAt: '2026-11-08T03:00:00.000Z' })], emptyUnbox(), NOW);
    expect(report.weekdays.map(day => day.lines)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(report.timeOfDay.map(slot => slot.lines)).toEqual([1, 1, 0, 0]);
  });

  it('notes a late-night habit only with enough lines to say so', () => {
    const lateNight = '2026-11-04T17:00:00.000Z';
    const few = habitsReport([item({ addedAt: lateNight }), item({ addedAt: lateNight }), item({ addedAt: lateNight })], emptyUnbox(), NOW);
    expect(few.observations.some(text => text.includes('凌晨'))).toBe(false);
    const many = habitsReport([0, 1, 2, 3].map(() => item({ addedAt: lateNight })), emptyUnbox(), NOW);
    expect(many.observations.some(text => text.includes('4 筆裡有 4 筆是凌晨'))).toBe(true);
  });

  it('separates opened parcels from unopened ones and says how long the oldest has waited', () => {
    const [a, b, c] = [item({ priceTwd: 100, addedAt: '2026-11-01T04:00:00.000Z' }), item({ priceTwd: 200, addedAt: '2026-11-05T04:00:00.000Z' }), item({ priceTwd: 300 })];
    const report = habitsReport([a, b, c], { opened: { [c.id]: NOW } }, NOW);
    expect(report.parcels).toEqual({ opened: 1, unopened: 2, unopenedSpendTwd: 300, oldestUnopened: { id: a.id, title: a.title, days: 9 } });
    expect(report.observations.join('')).toContain(`最久的「${a.title}」已經放了 9 天`);
  });

  it('does not count unbox records for items that are not in the cart', () => {
    const only = item();
    expect(habitsReport([only], { opened: { 'item-gone': NOW } }, NOW).parcels.opened).toBe(0);
  });

  it('never gives more than three observations', () => {
    const cart = [0, 1, 2, 3].map(() => item({ category: 'home', priceTwd: 500, addedAt: '2026-10-20T17:00:00.000Z' })).concat(item());
    expect(habitsReport(cart, emptyUnbox(), NOW).observations.length).toBeLessThanOrEqual(3);
  });
});
