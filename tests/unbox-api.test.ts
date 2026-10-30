import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cartSchema } from '../shared/cart';
import { fixtureCartItems } from '../shared/fixtures/cart';
import { unboxStateSchema } from '../shared/unbox';
import type { Env } from '../worker/env';
import { Showroom } from '../worker/showroom';
import { memoryState } from './memory-state';

const token = 'test-token-0123456789';
const env = { CART_MCP_TOKEN: token } as Env;
const auth = { authorization: `Bearer ${token}` };
const call = (room: Showroom, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  room.fetch(new Request(`https://showroom.test${path}`, { method: init.method, headers: { 'content-type': 'application/json', ...init.headers }, body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body) }));
const unbox = async (room: Showroom) => unboxStateSchema.parse(await (await call(room, '/api/unbox', { headers: auth })).json());
const open = (room: Showroom, itemIds: string[]) => call(room, '/api/unbox', { method: 'POST', body: { itemIds }, headers: auth });
const stocked = async (state = memoryState()) => {
  const room = new Showroom(state, env);
  const cart = cartSchema.parse(await (await call(room, '/api/cart', { method: 'POST', body: { items: fixtureCartItems }, headers: auth })).json());
  return { room, ids: cart.items.map(item => item.id) };
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T03:00:00.000Z')); });
afterEach(() => vi.useRealTimers());

describe('/api/unbox', () => {
  it('is for the owner only', async () => {
    const { room, ids } = await stocked();
    for (const headers of [{}, { authorization: 'Bearer test-token-0123456780' }] as Record<string, string>[]) {
      expect((await call(room, '/api/unbox', { headers })).status).toBe(401);
      expect((await call(room, '/api/unbox', { method: 'POST', body: { itemIds: ids }, headers })).status).toBe(401);
    }
    expect((await unbox(room)).opened).toEqual({});
  });

  it('starts with every parcel unopened and records the ones opened', async () => {
    const { room, ids } = await stocked();
    expect(await unbox(room)).toEqual({ opened: {} });
    const answer = await open(room, [ids[0], ids[2]]);
    expect(answer.status).toBe(200);
    expect(unboxStateSchema.parse(await answer.json()).opened).toEqual({ [ids[0]]: '2026-10-30T03:00:00.000Z', [ids[2]]: '2026-10-30T03:00:00.000Z' });
    expect(Object.keys((await unbox(room)).opened)).toEqual([ids[0], ids[2]]);
  });

  it('keeps the first time when a parcel is opened again', async () => {
    const { room, ids } = await stocked();
    await open(room, [ids[0]]);
    vi.setSystemTime(new Date('2026-10-30T09:30:00.000Z'));
    const again = unboxStateSchema.parse(await (await open(room, [ids[0], ids[1]])).json());
    expect(again.opened).toEqual({ [ids[0]]: '2026-10-30T03:00:00.000Z', [ids[1]]: '2026-10-30T09:30:00.000Z' });
    expect(unboxStateSchema.parse(await (await open(room, [ids[0], ids[1]])).json())).toEqual(again);
  });

  it('ignores ids that are not in the cart', async () => {
    const { room, ids } = await stocked();
    const answer = unboxStateSchema.parse(await (await open(room, ['item-nope-0', ids[3]])).json());
    expect(Object.keys(answer.opened)).toEqual([ids[3]]);
  });

  it('drops the record of an item that left the cart, on the next write and in what it reads back', async () => {
    const { room, ids } = await stocked();
    await open(room, ids);
    await call(room, '/api/cart', { method: 'POST', body: { items: fixtureCartItems.slice(1) }, headers: auth });
    expect(Object.keys((await unbox(room)).opened)).toEqual(ids.slice(1));
    expect(Object.keys(unboxStateSchema.parse(await (await open(room, [ids[1]])).json()).opened)).toEqual(ids.slice(1));
  });

  it('keeps what was opened for the next object over the same storage', async () => {
    const state = memoryState(), { room, ids } = await stocked(state);
    await open(room, [ids[1]]);
    expect(Object.keys((await unbox(new Showroom(state, env))).opened)).toEqual([ids[1]]);
  });

  it('refuses a body that is not 1 to 50 ids, and other methods', async () => {
    const { room, ids } = await stocked();
    expect((await open(room, [])).status).toBe(400);
    expect((await open(room, Array.from({ length: 51 }, (_, i) => `item-${i}`))).status).toBe(400);
    expect((await call(room, '/api/unbox', { method: 'POST', body: '{nope', headers: auth })).status).toBe(400);
    expect((await call(room, '/api/unbox', { method: 'POST', body: { itemIds: ids, extra: 1 }, headers: auth })).status).toBe(400);
    expect((await call(room, '/api/unbox', { method: 'DELETE', headers: auth })).status).toBe(405);
    expect((await unbox(room)).opened).toEqual({});
  });
});

describe('worker', () => {
  it('sends /api/unbox to the default showroom', async () => {
    const asked: string[] = [];
    const fake = {
      SHOWROOM: { idFromName: (name: string) => name, get: (id: string) => ({ fetch: async (request: Request) => { asked.push(`${id}:${new URL(request.url).pathname}`); return Response.json({ opened: {} }); } }) } as unknown as DurableObjectNamespace,
      ASSETS: { fetch: async () => new Response('app') } as unknown as Fetcher,
      MEDIA: {} as R2Bucket,
    } as Env;
    const { default: worker } = await import('../worker/index');
    await worker.fetch(new Request('https://showroom.test/api/unbox') as Parameters<typeof worker.fetch>[0], fake);
    expect(asked).toEqual(['default:/api/unbox']);
  });
});
