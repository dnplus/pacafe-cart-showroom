import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cartSchema } from '../shared/cart';
import { MAX_REMOVALS, recordRemoval, recentRemovals, removalOf, removedBefore, type Removal } from '../shared/removals';
import { cartCue } from '../src/room/castMotion';
import { pruneHidden, withoutRemoved } from '../src/cart/removal';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { Showroom } from '../worker/showroom';
import { memoryState } from './memory-state';

const token = 'test-token-0123456789', origin = 'https://showroom.test', auth = { authorization: `Bearer ${token}` };

function world() {
  const state = memoryState();
  const env = { CART_MCP_TOKEN: token, SHOWROOM: { idFromName: (name: string) => name, get: () => new Showroom(state, env) }, ASSETS: { fetch: async () => new Response('app') } } as unknown as Env;
  const send = (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => worker.fetch(new Request(`${origin}${path}`, { method: init.method, headers: { 'content-type': 'application/json', ...init.headers }, body: init.body === undefined ? undefined : JSON.stringify(init.body) }) as Parameters<typeof worker.fetch>[0], env);
  let id = 1;
  const call = async (name: string, args: unknown = {}) => (await (await send('/mcp', { method: 'POST', headers: auth, body: { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } } })).json() as any).result;
  const stock = async (items: object[]) => cartSchema.parse(await (await send('/api/cart', { method: 'POST', headers: auth, body: { items } })).json());
  const remove = (body: unknown, headers: Record<string, string> = auth) => send('/api/cart/remove', { method: 'POST', headers, body });
  return { send, call, stock, remove };
}
const pan = { title: '鑄鐵平底鍋 24cm', store: 'Lodge', url: 'https://shop.test/pan', priceTwd: 3990, category: 'kitchen' };
const mug = { title: '手拉坏馬克杯', url: 'https://shop.test/mug', priceTwd: 650 };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T03:00:00.000Z')); });
afterEach(() => vi.useRealTimers());

describe('POST /api/cart/remove', () => {
  it('is for the owner only, and only POST', async () => {
    const { send, remove, stock } = world();
    const [first] = (await stock([pan, mug])).items;
    for (const headers of [{}, { authorization: 'Bearer test-token-0123456780' }] as Record<string, string>[]) expect((await remove({ itemId: first.id }, headers)).status).toBe(401);
    expect((await send('/api/cart/remove', { headers: auth })).status).toBe(405);
    expect(cartSchema.parse(await (await send('/api/cart', { headers: auth })).json()).items).toHaveLength(2);
  });

  it('takes the line off the shelf and logs a snapshot with the reason', async () => {
    const { send, remove, stock } = world();
    const [first, second] = (await stock([pan, mug])).items;
    const answer = await remove({ itemId: first.id, reason: 'too_expensive' });
    expect(answer.status).toBe(200);
    const body = await answer.json() as any;
    expect(body.removal).toEqual({ item: { title: pan.title, url: pan.url, store: 'Lodge', category: 'kitchen', priceTwd: 3990 }, reason: 'too_expensive', removedAt: '2026-10-30T03:00:00.000Z', by: 'owner' });
    expect(cartSchema.parse(body.cart).items.map(item => item.id)).toEqual([second.id]);
    expect(cartSchema.parse(await (await send('/api/cart', { headers: auth })).json())).toMatchObject({ totalTwd: 650, items: [{ id: second.id, shelfSlot: 0 }] });
  });

  it('takes a removal without a reason, and refuses an unknown item, reason or field', async () => {
    const { remove, stock } = world();
    const [first, second] = (await stock([pan, mug])).items;
    expect(((await (await remove({ itemId: first.id })).json()) as any).removal.reason).toBeNull();
    expect((await remove({ itemId: first.id })).status).toBe(404);
    expect((await remove({ itemId: second.id, reason: 'boring' })).status).toBe(400);
    expect((await remove({ itemId: second.id, qty: 1 })).status).toBe(400);
    expect((await remove({})).status).toBe(400);
  });
});

describe('the removal log', () => {
  const entry = (n: number): Removal => ({ item: { title: `thing ${n}`, url: null, store: null, category: null, priceTwd: null }, reason: null, removedAt: '2026-10-30T03:00:00.000Z', by: 'owner' });

  it('keeps the latest MAX_REMOVALS, oldest dropped first', () => {
    const log = Array.from({ length: MAX_REMOVALS + 5 }, (_, n) => n).reduce<Removal[]>((so, n) => recordRemoval(so, entry(n)), []);
    expect(log).toHaveLength(MAX_REMOVALS);
    expect(log[0].item.title).toBe('thing 5');
    expect(recentRemovals(log)[0].item.title).toBe(`thing ${MAX_REMOVALS + 4}`);
    expect(recentRemovals(log)).toHaveLength(20);
  });

  it('matches a removed item by link or by title, newest removal first', () => {
    const log = [removalOf({ ...entryItem('Tea', 'https://a.test/t'), } as any, 'too_expensive', 'x'), removalOf(entryItem('Tea', 'https://a.test/t') as any, 'changed_mind', 'y')];
    expect(removedBefore(log, { title: 'Other name', url: 'https://a.test/t' })?.reason).toBe('changed_mind');
    expect(removedBefore(log, { title: ' tea ' })?.reason).toBe('changed_mind');
    expect(removedBefore(log, { title: 'Coffee', url: 'https://a.test/c' })).toBeUndefined();
  });

  it('persists across calls and bounds itself in the Durable Object', async () => {
    const { remove, stock, call } = world();
    for (let n = 0; n < MAX_REMOVALS + 2; n++) {
      const [item] = (await stock([{ title: `item ${n}`, url: `https://shop.test/${n}` }])).items;
      await remove({ itemId: item.id });
    }
    const listed = await call('cart_list');
    expect(listed.structuredContent.removals).toHaveLength(20);
    const readded = await call('cart_add', { title: 'item 0', url: 'https://shop.test/0' });
    expect(readded.structuredContent.note).toBeUndefined();
  });
});
const entryItem = (title: string, url: string) => ({ title, url, store: null, category: null, priceTwd: null });

describe('what Muse hears over MCP', () => {
  it('cart_list lists the owner removals newest first, with reasons', async () => {
    const { call, remove, stock } = world();
    const [first, second] = (await stock([pan, mug])).items;
    await remove({ itemId: first.id, reason: 'not_my_taste' });
    vi.setSystemTime(new Date('2026-10-30T04:00:00.000Z'));
    await remove({ itemId: second.id });
    const listed = (await call('cart_list')).structuredContent;
    expect(listed.items).toEqual([]);
    expect(listed.removals.map((r: Removal) => [r.item.title, r.reason, r.removedAt, r.by])).toEqual([
      [mug.title, null, '2026-10-30T04:00:00.000Z', 'owner'],
      [pan.title, 'not_my_taste', '2026-10-30T03:00:00.000Z', 'owner'],
    ]);
  });

  it('cart_list has an empty removals list before the owner removed anything', async () => {
    expect(((await world().call('cart_list')).structuredContent).removals).toEqual([]);
  });

  it('cart_add adds an item the owner removed, but says so, naming the reason', async () => {
    const { call, remove, stock } = world();
    const [first] = (await stock([pan])).items;
    await remove({ itemId: first.id, reason: 'too_expensive' });
    const byUrl = (await call('cart_add', { title: '另一個名字的鍋子', url: pan.url })).structuredContent;
    expect(byUrl.items).toHaveLength(1);
    expect(byUrl.note).toContain(pan.title);
    expect(byUrl.note).toContain('太貴');
    expect(byUrl.note).toContain('2026-10-30');
    await call('cart_remove', { itemId: byUrl.items[0].id });
    const byTitle = (await call('cart_add', { title: pan.title.toUpperCase() })).structuredContent;
    expect(byTitle.note).toContain('太貴');
  });

  it('cart_add stays quiet about something the owner never removed', async () => {
    const { call, remove, stock } = world();
    const [first] = (await stock([pan])).items;
    await remove({ itemId: first.id });
    expect((await call('cart_add', mug)).structuredContent.note).toBeUndefined();
  });

  it('a removal Muse makes with cart_remove is not the owner and is not logged', async () => {
    const { call, stock } = world();
    const [first] = (await stock([pan])).items;
    await call('cart_remove', { itemId: first.id });
    expect((await call('cart_list')).structuredContent.removals).toEqual([]);
  });
});

describe('the undo window in the room', () => {
  const items = [pan, mug].map((item, n) => ({ ...item, id: `i${n}` })) as any[];

  it('hides lines waiting out their window and drops ids the cart no longer lists', () => {
    expect(withoutRemoved(items, new Set(['i0'])).map(item => item.id)).toEqual(['i1']);
    const hidden = new Set(['i0', 'gone']);
    expect([...pruneHidden(hidden, items)]).toEqual(['i0']);
    expect(pruneHidden(new Set(['i0']), items)).toEqual(new Set(['i0']));
  });

  it('gives the clerk a cue when the cart shrinks, and not on the first look', () => {
    expect(cartCue({ items: 3, shelved: 3 }, { items: 2, shelved: 2 })).toBe('removed');
    expect(cartCue(null, { items: 2, shelved: 2 })).toBeNull();
  });
});
