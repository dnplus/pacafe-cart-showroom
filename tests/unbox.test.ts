import { describe, expect, it } from 'vitest';
import { emptyCart, formatTwd, replaceCart } from '../shared/cart';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { ownerShelf } from '../src/cart/shelf';
import { extendSlit, SLICE_DONE, shelvedIds, sliceProgress, unboxReducer, type Box, type Slit, type TapePoint, type UnboxEvent } from '../src/cart/unbox';

const run = (events: readonly UnboxEvent[], from: readonly Box[] = []) => events.reduce(unboxReducer, from);
const phases = (boxes: readonly Box[]) => boxes.map(box => `${box.id}:${box.phase}`);
const arrive = (...ids: string[]): UnboxEvent[] => ids.map(id => ({ type: 'arrived', id }));
const nothingOpened = new Set<string>();

describe('a parcel on its way to the shelf', () => {
  it('arrives, waits at the counter, is cut halfway, opens and ends up shelved', () => {
    const arrived = run([{ type: 'sync', ids: ['mug'], opened: nothingOpened }]);
    expect(arrived).toEqual([{ id: 'mug', phase: 'arriving' }]);
    expect(run([{ type: 'arrived', id: 'mug' }], arrived)).toEqual([{ id: 'mug', phase: 'atCounter' }]);
    const halfway = run([{ type: 'arrived', id: 'mug' }, { type: 'slice', id: 'mug', progress: 0.4 }, { type: 'slice', id: 'mug', progress: 0.6 }], arrived);
    expect(halfway).toEqual([{ id: 'mug', phase: 'slicing', progress: 0.6 }]);
    const opened = run([{ type: 'slice', id: 'mug', progress: SLICE_DONE }], halfway);
    expect(opened).toEqual([{ id: 'mug', phase: 'opened' }]);
    expect(shelvedIds(opened).size).toBe(0);
    const shelved = run([{ type: 'shelved', ids: ['mug'] }], opened);
    expect(phases(shelved)).toEqual(['mug:shelved']);
    expect([...shelvedIds(shelved)]).toEqual(['mug']);
  });

  it('goes back to the counter, uncut, when the finger lifts before the tape is done', () => {
    const cutting = run([...arrive('mug'), { type: 'slice', id: 'mug', progress: 0.7 }], [{ id: 'mug', phase: 'arriving' }]);
    expect(cutting[0].phase).toBe('slicing');
    const lifted = run([{ type: 'release', id: 'mug' }], cutting);
    expect(lifted).toEqual([{ id: 'mug', phase: 'atCounter' }]);
    expect(run([{ type: 'slice', id: 'mug', progress: 0.3 }], lifted)).toEqual([{ id: 'mug', phase: 'slicing', progress: 0.3 }]);
  });

  it('does not open from a slice it has not earned, and ignores events for the wrong phase', () => {
    const waiting = run([{ type: 'sync', ids: ['mug'], opened: nothingOpened }]);
    expect(run([{ type: 'slice', id: 'mug', progress: 1 }], waiting)).toEqual(waiting);
    expect(run([{ type: 'shelved', ids: ['mug'] }], run(arrive('mug'), waiting))).toEqual([{ id: 'mug', phase: 'atCounter' }]);
    const opened = run([{ type: 'slice', id: 'mug', progress: 1 }], run(arrive('mug'), waiting));
    expect(run([{ type: 'slice', id: 'mug', progress: 0.2 }, { type: 'release', id: 'mug' }, { type: 'arrived', id: 'mug' }], opened)).toEqual(opened);
  });

  it('opens every parcel that is not shelved yet when told to, then shelves the lot', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const mixed = run([{ type: 'sync', ids, opened: new Set(['d']) }, ...arrive('b', 'c'), { type: 'slice', id: 'c', progress: 0.5 }]);
    expect(phases(mixed)).toEqual(['a:arriving', 'b:atCounter', 'c:slicing', 'd:shelved']);
    const all = run([{ type: 'openAll' }], mixed);
    expect(phases(all)).toEqual(['a:opened', 'b:opened', 'c:opened', 'd:shelved']);
    expect(phases(run([{ type: 'shelved', ids: ['a', 'b', 'c'] }], all))).toEqual(ids.map(id => `${id}:shelved`));
  });

  it('keeps one popping out until its write lands, and shelves the ones the server already knew', () => {
    const popping = run([{ type: 'sync', ids: ['a', 'b'], opened: nothingOpened }, ...arrive('a', 'b'), { type: 'slice', id: 'a', progress: 1 }]);
    const again = run([{ type: 'sync', ids: ['a', 'b'], opened: new Set(['a']) }], popping);
    expect(phases(again)).toEqual(['a:opened', 'b:atCounter']);
    expect(phases(run([{ type: 'sync', ids: ['a', 'b'], opened: new Set(['a', 'b']) }], again))).toEqual(['a:opened', 'b:shelved']);
  });

  it('follows the cart: new items arrive in order, removed ones go, the others keep their phase', () => {
    const before = run([{ type: 'sync', ids: ['a', 'b'], opened: nothingOpened }, ...arrive('a', 'b'), { type: 'slice', id: 'b', progress: 0.5 }]);
    const after = run([{ type: 'sync', ids: ['b', 'c', 'a'], opened: nothingOpened }], before);
    expect(phases(after)).toEqual(['b:slicing', 'c:arriving', 'a:atCounter']);
    expect(phases(run([{ type: 'sync', ids: ['c'], opened: nothingOpened }], after))).toEqual(['c:arriving']);
  });
});

describe('the owner\'s shelf', () => {
  const cart = replaceCart(emptyCart(), fixtureCartItems, '2026-10-30T03:00:00.000Z');

  it('draws only the items that were unboxed, but the register still totals the whole cart', () => {
    const shelf = ownerShelf(cart, new Set([cart.items[1].id, cart.items[3].id]));
    expect(shelf.items.map(item => item.title)).toEqual([fixtureCartItems[1].title, fixtureCartItems[3].title]);
    expect(shelf.register).toBe(formatTwd(7460));
  });
  it('is bare while every item is still in its box', () => {
    expect(ownerShelf(cart, new Set()).items).toEqual([]);
  });
});

describe('cutting the tape', () => {
  /** A stroke along a tape 200 px long and 20 px thick, as the pointer moves through these x positions at `off` px from its centerline. */
  const reach = 36;
  const stroke = (xs: readonly number[], off = 0): Slit | null => xs.reduce<Slit | null>((slit, x) => extendSlit(slit, { along: x / 200, off }, reach), null);
  const point = (along: number, off = 0): TapePoint => ({ along, off });

  it('counts the share of the tape a stroke has swept', () => {
    expect(sliceProgress(stroke([0, 50, 100]))).toBeCloseTo(0.5);
    expect(sliceProgress(stroke([0, 100, 200]))).toBe(1);
    expect(sliceProgress(null)).toBe(0);
  });
  it('reaches the opening mark with one swipe from end to end, in either direction', () => {
    expect(sliceProgress(stroke([4, 60, 120, 180, 196]))).toBeGreaterThanOrEqual(SLICE_DONE);
    expect(sliceProgress(stroke([196, 120, 60, 4]))).toBeGreaterThanOrEqual(SLICE_DONE);
  });
  it('does not count going back and forth over the same stretch twice', () => {
    expect(sliceProgress(stroke([20, 120, 20, 120, 60, 100]))).toBeCloseTo(0.5);
  });
  it('counts the tape to its end when the stroke overshoots it', () => {
    expect(sliceProgress(stroke([-30, 100, 260]))).toBe(1);
  });
  it('cuts nothing when the swipe runs beside the tape, and starts over when the finger strays off it', () => {
    expect(extendSlit(null, point(0.5, 60), reach)).toBeNull();
    expect(sliceProgress(stroke([0, 100, 200], 60))).toBe(0);
    const strayed = extendSlit(stroke([0, 100]), point(0.6, -80), reach);
    expect(strayed).toBeNull();
    expect(sliceProgress(extendSlit(strayed, point(0.9), reach))).toBe(0);
  });
  it('lets a finger drift a little off the centerline', () => {
    expect(sliceProgress(stroke([0, 100, 200], 30))).toBe(1);
  });
});
