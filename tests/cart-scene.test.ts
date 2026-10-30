import { describe, expect, it } from 'vitest';
import { emptyCart, replaceCart, SHELF_COLUMNS, SHELF_SLOTS } from '../shared/cart';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { registerText, shelfSlotPosition } from '../src/cart/cartScene';
import { shelfFrame } from '../src/room/furnitureModels';

describe('the register', () => {
  it('shows the cart total, formatted as the room writes amounts', () => {
    expect(registerText(replaceCart(emptyCart(), fixtureCartItems, '2026-10-30T03:00:00.000Z').items)).toBe('NT$ 7,460');
  });
  it('counts quantities and shows zero for an empty cart', () => {
    expect(registerText(replaceCart(emptyCart(), [{ title: 'socks', priceTwd: 1250, qty: 4 }], '2026-10-30T03:00:00.000Z').items)).toBe('NT$ 5,000');
    expect(registerText([])).toBe('NT$ 0');
  });
});

describe('shelf slots', () => {
  const slots = Array.from({ length: SHELF_SLOTS }, (_, slot) => shelfSlotPosition(slot));
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
