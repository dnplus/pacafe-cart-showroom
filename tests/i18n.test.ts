import { describe, expect, it } from 'vitest';
import { habitsReport } from '../shared/habits';
import { emptyUnbox } from '../shared/unbox';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { emptyCart, replaceCart } from '../shared/cart';
import { translate } from '../src/i18n';
import { messages } from '../src/i18n/messages';

describe('two languages', () => {
  it('has a Chinese line for every English key, and no key twice', () => {
    const keys = messages.map(row => row[0]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(messages.filter(row => !row[1]?.trim())).toEqual([]);
  });

  it('says one line, two lines in English, and Chinese the same way for both', () => {
    expect(translate('en', '{count} lines', { count: 1 })).toBe('1 line');
    expect(translate('en', '{count} lines', { count: 2 })).toBe('2 lines');
    expect(translate('zh-TW', '{count} lines', { count: 1 })).toBe(translate('zh-TW', '{count} lines', { count: 2 }).replace('2', '1'));
  });

  it('writes the habits report in either language with the same numbers', () => {
    const cart = replaceCart(emptyCart(), fixtureCartItems, '2026-10-31T01:00:00.000Z');
    const zh = habitsReport(cart.items, emptyUnbox(), '2026-11-02T01:00:00.000Z'), en = habitsReport(cart.items, emptyUnbox(), '2026-11-02T01:00:00.000Z', 'en');
    expect(en.totals).toEqual(zh.totals);
    expect(en.categories.map(row => row.spendTwd)).toEqual(zh.categories.map(row => row.spendTwd));
    expect([en.note, ...en.observations, ...en.categories.map(row => row.label), ...en.weekdays.map(row => row.label)].join(' ')).not.toMatch(/[一-鿿]/);
    expect(zh.observations.join('')).toMatch(/[一-鿿]/);
  });
});
